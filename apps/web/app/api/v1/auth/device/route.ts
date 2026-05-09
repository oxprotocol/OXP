/**
 * POST /api/v1/auth/device  — start a device-authorization session.
 *
 * Public endpoint (no auth). The CLI calls this once to obtain a long
 * `device_code` it polls with, plus a short `user_code` it shows the
 * developer to type into the browser.
 *
 * Request body (all optional):
 *   {
 *     "scopes"?: string[]   // default ["publish:@<handle>/*"] resolved at approve
 *     "name"?:   string     // human label for the resulting ApiToken
 *   }
 *
 * Response 200:
 *   {
 *     "deviceCode":      "...64hex...",
 *     "userCode":        "ABCD-1234",
 *     "verificationUri": "http://host/auth/device",
 *     "verificationUriComplete": "http://host/auth/device?code=ABCD-1234",
 *     "expiresIn":       600,
 *     "interval":        2
 *   }
 *
 * Per RFC 8628 the `device_code` is opaque and ONLY the CLI ever sees it.
 * The DB stores `sha256(device_code)`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DEVICE_POLL_INTERVAL_S,
  DEVICE_TTL_MS,
  newDeviceCode,
  newUserCode,
  sha256Hex,
} from "@/lib/device-auth";
import { isValidScope } from "@oxprotocol/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { scopes?: unknown; name?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const requestedScopes: string[] = Array.isArray(body.scopes)
    ? (body.scopes as unknown[])
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Reject malformed scope strings up-front so we don't store garbage that
  // would later silently fail at approval time.
  for (const s of requestedScopes) {
    if (!isValidScope(s)) {
      return NextResponse.json(
        { error: "invalid_scope", scope: s },
        { status: 400 },
      );
    }
  }

  // Find a free user code. Collisions in 28^8 are vanishingly rare but the
  // unique constraint forces a retry rather than swallowing the duplicate.
  let userCode = "";
  let deviceCode = "";
  for (let i = 0; i < 5; i++) {
    userCode = newUserCode();
    deviceCode = newDeviceCode();
    const existing = await prisma.deviceAuth.findUnique({
      where: { userCode },
    });
    if (!existing) break;
    userCode = "";
  }
  if (!userCode) {
    return NextResponse.json(
      { error: "could not allocate user code, retry" },
      { status: 503 },
    );
  }

  const now = Date.now();
  await prisma.deviceAuth.create({
    data: {
      deviceCodeHash: sha256Hex(deviceCode),
      userCode,
      requestedScopes,
      expiresAt: new Date(now + DEVICE_TTL_MS),
    },
  });

  // Build absolute URLs from the request so this works behind a proxy
  // (`req.nextUrl.origin` honours x-forwarded-host when Next is configured
  // with `trustHostHeader`; we just use it as-is).
  const origin = req.nextUrl.origin;
  return NextResponse.json(
    {
      deviceCode,
      userCode,
      verificationUri: `${origin}/auth/device`,
      verificationUriComplete: `${origin}/auth/device?code=${userCode}`,
      expiresIn: Math.floor(DEVICE_TTL_MS / 1000),
      interval: DEVICE_POLL_INTERVAL_S,
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
