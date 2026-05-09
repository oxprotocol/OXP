/**
 * POST /api/v1/tokens/rotate
 *
 * Mint a successor token with the SAME scopes as the calling token,
 * then put the calling token into a short grace window so any
 * in-flight publish completes. Body is optional:
 *
 *   {
 *     "name"?:    string,   // human-readable label for the new token
 *     "ttlDays"?: number,   // override default expiry; null = no expiry (admin)
 *     "scopes"?:  string[], // optional NARROWING — must be a subset
 *   }
 *
 * Auth: any valid bearer token. Self-rotation is always allowed; the
 * `tokens:rotate` scope only matters for cross-token admin flows
 * (not yet exposed in the API).
 *
 * Response (201):
 *   {
 *     "ok": true,
 *     "token": "oxp-raw-secret-once",
 *     "tokenId": "...",
 *     "scopes": [...],
 *     "expiresAt": "2026-08-01T00:00:00.000Z",
 *     "previousTokenId": "...",
 *     "previousExpiresAt": "2026-05-03T00:05:00.000Z"
 *   }
 *
 * The raw secret is returned exactly once — same contract as
 * issue-token.mjs. Clients (the CLI) MUST persist it before the
 * grace window elapses, otherwise the next publish fails.
 */

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateBearer } from "@/lib/api-auth";
import { recordAudit } from "@/lib/audit";
import {
  DEFAULT_TOKEN_TTL_DAYS,
  ROTATION_GRACE_MS,
  isValidScope,
} from "@/lib/token-scopes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: {
    name?: unknown;
    ttlDays?: unknown;
    scopes?: unknown;
  } = {};
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json(
        { ok: false, error: "invalid JSON body" },
        { status: 400 },
      );
    }
  }

  const oldToken = auth.auth.token;

  // Resolve scopes for the successor — default to inherit, but allow
  // narrowing to a subset. Refuse any scope not present in the parent
  // (a token can never widen its own permissions).
  let newScopes = oldToken.scopes;
  if (Array.isArray(body.scopes)) {
    const requested = (body.scopes as unknown[])
      .map(String)
      .map((s) => s.trim());
    const parentSet = new Set(oldToken.scopes);
    const widening = requested.filter(
      (s) => !parentSet.has(s) && !parentSet.has("*"),
    );
    if (widening.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `cannot widen scope: ${widening.join(", ")} not held by current token`,
        },
        { status: 403 },
      );
    }
    const malformed = requested.filter((s) => !isValidScope(s));
    if (malformed.length > 0) {
      return NextResponse.json(
        { ok: false, error: `malformed scope: ${malformed.join(", ")}` },
        { status: 400 },
      );
    }
    newScopes = requested;
  }

  // Resolve expiry. `null` ttlDays = explicit "no expiry" (only honoured
  // for admin tokens with `*`); anything else clamps to a positive int.
  let expiresAt: Date | null;
  if (body.ttlDays === null) {
    if (!oldToken.scopes.includes("*")) {
      return NextResponse.json(
        { ok: false, error: "non-admin tokens must have an expiry" },
        { status: 400 },
      );
    }
    expiresAt = null;
  } else {
    const ttl =
      typeof body.ttlDays === "number" && Number.isFinite(body.ttlDays)
        ? Math.max(1, Math.floor(body.ttlDays))
        : DEFAULT_TOKEN_TTL_DAYS;
    expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
  }

  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, 200)
      : `${oldToken.name} (rotated ${new Date().toISOString().slice(0, 10)})`;

  const raw = `oxp_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(raw).digest("hex");

  // Mint successor + retire old token in a single transaction so we
  // can't end up with two valid tokens (or zero) on a partial failure.
  const graceUntil = new Date(Date.now() + ROTATION_GRACE_MS);
  // Only shorten the old token's expiry if the current one is later
  // than the grace window — never EXTEND a token via rotation.
  const newOldExpiresAt =
    oldToken.expiresAt && oldToken.expiresAt < graceUntil
      ? oldToken.expiresAt
      : graceUntil;

  const [created] = await prisma.$transaction([
    prisma.apiToken.create({
      data: {
        userId: oldToken.userId,
        name,
        tokenHash,
        scopes: newScopes,
        expiresAt,
      },
    }),
    prisma.apiToken.update({
      where: { id: oldToken.id },
      data: { expiresAt: newOldExpiresAt },
    }),
  ]);

  await recordAudit({
    action: "token.create",
    target: created.id,
    actorUserId: oldToken.userId,
    metadata: {
      source: "cli-rotate",
      rotatedFrom: oldToken.id,
      scopes: newScopes,
    },
  });
  await recordAudit({
    action: "token.revoke",
    target: oldToken.id,
    actorUserId: oldToken.userId,
    metadata: { reason: "rotated", successor: created.id },
  });

  return NextResponse.json(
    {
      ok: true,
      token: raw,
      tokenId: created.id,
      scopes: created.scopes,
      expiresAt: created.expiresAt,
      previousTokenId: oldToken.id,
      previousExpiresAt: newOldExpiresAt.toISOString(),
    },
    { status: 201 },
  );
}
