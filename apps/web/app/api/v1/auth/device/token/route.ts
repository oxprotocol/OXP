/**
 * POST /api/v1/auth/device/token  — exchange a `device_code` for an ApiToken.
 *
 * Public endpoint (no auth — the device_code IS the auth). The CLI polls
 * this endpoint while the user approves in the browser.
 *
 * Request body:
 *   { "deviceCode": "...64hex..." }
 *
 * Responses (mirroring RFC 8628 error codes loosely):
 *   200 { ok: true, token, scopes, expiresAt, handle }
 *     — token is returned EXACTLY ONCE; consumedAt is set so a second poll
 *       returns 410 instead of leaking the secret again
 *   400 { error: "authorization_pending" }    — still waiting on user
 *   400 { error: "access_denied" }            — user clicked Deny
 *   400 { error: "expired_token" }            — TTL elapsed (10 min)
 *   400 { error: "invalid_grant" }            — unknown / malformed code
 *   410 { error: "already_consumed" }         — token already retrieved
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEVICE_USER_CODE_TTL_DAYS, sha256Hex } from "@/lib/device-auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function reply(error: string, status = 400) {
  return NextResponse.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: { deviceCode?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return reply("invalid_request");
  }
  const deviceCode =
    typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
  if (!deviceCode) return reply("invalid_request");

  const session = await prisma.deviceAuth.findUnique({
    where: { deviceCodeHash: sha256Hex(deviceCode) },
    include: { user: true, token: true },
  });
  if (!session) return reply("invalid_grant");

  if (session.consumedAt) return reply("already_consumed", 410);
  if (session.expiresAt.getTime() < Date.now()) return reply("expired_token");
  if (session.deniedAt) return reply("access_denied");
  if (!session.approvedAt || !session.userId) {
    return reply("authorization_pending");
  }

  // Approved by an interactive user, but no token row yet — mint one now,
  // bind it to the session, and consume the session in one transaction so
  // a duplicate poll cannot mint a second token.
  const result = await prisma.$transaction(async (tx) => {
    // Re-read inside the tx to avoid TOCTOU between the SELECT above and
    // the consume here.
    const fresh = await tx.deviceAuth.findUnique({
      where: { id: session.id },
    });
    if (!fresh || fresh.consumedAt) {
      return { kind: "already_consumed" as const };
    }

    let tokenId = fresh.tokenId;
    let raw: string | null = null;

    if (!tokenId) {
      raw = `oxp_${randomBytes(32).toString("hex")}`;
      const tokenHash = createHash("sha256").update(raw).digest("hex");
      const expiresAt = new Date(
        Date.now() + DEVICE_USER_CODE_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      const tok = await tx.apiToken.create({
        data: {
          userId: fresh.userId!,
          name: `cli-${new Date().toISOString().slice(0, 10)}`,
          tokenHash,
          scopes: fresh.requestedScopes,
          expiresAt,
        },
      });
      tokenId = tok.id;
    }

    await tx.deviceAuth.update({
      where: { id: fresh.id },
      data: { consumedAt: new Date(), tokenId },
    });

    const token = await tx.apiToken.findUnique({ where: { id: tokenId } });
    return { kind: "ok" as const, token, raw };
  });

  if (result.kind === "already_consumed") return reply("already_consumed", 410);
  if (!result.token || !result.raw) {
    // Token was minted in a prior poll but the raw secret was already shown.
    // Per the contract above the secret is one-shot; treat a second poll as
    // already-consumed rather than re-issuing.
    return reply("already_consumed", 410);
  }

  await recordAudit({
    action: "token.create",
    target: result.token.id,
    actorUserId: result.token.userId,
    metadata: { source: "device-flow", scopes: result.token.scopes },
  });

  const handleRow = await prisma.user.findUnique({
    where: { id: result.token.userId },
    select: { handle: true },
  });

  return NextResponse.json(
    {
      ok: true,
      token: result.raw,
      tokenId: result.token.id,
      scopes: result.token.scopes,
      expiresAt: result.token.expiresAt,
      handle: handleRow?.handle ?? null,
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
