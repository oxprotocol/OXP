/**
 * POST /api/v1/auth/login — Expo-style direct credentials → API token.
 *
 * Public endpoint (no auth header). Verifies email + password against the
 * same bcrypt hash NextAuth's credentials provider uses, then mints a
 * fresh ApiToken and returns the raw secret exactly once. This is the
 * terminal-native counterpart to the device-flow at /api/v1/auth/device
 * and gives `oxp login` the same UX as `expo login` / `npm login`.
 *
 * Request body:
 *   { "email": "...", "password": "...", "name"?: "cli@laptop" }
 *
 * Response 200:
 *   { ok: true, token, scopes, expiresAt, handle }
 *
 * Response 401:
 *   { error: "invalid_credentials" }
 *
 * Notes:
 * - Constant-time-ish comparison via bcrypt. We always run a dummy hash on
 *   missing-user to avoid leaking account existence via response time.
 * - Default scopes are `publish:@<handle>/*` so the token can publish any
 *   package the user owns. A future flag could narrow this further.
 * - There is intentionally no MFA/OTP here yet — when MFA lands, gate it
 *   behind a `mfa_required` 401 so the CLI can re-prompt with `otp`.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEVICE_USER_CODE_TTL_DAYS } from "@/lib/device-auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Pre-computed bcrypt hash of a random string — used for timing-equalisation
// when the email doesn't exist. Cost factor matches what auth.ts uses (10).
const DUMMY_HASH =
  "$2a$10$CwTycUXWue0Thq9StjUM0uJ8t8K3hZ.0Z0Z0Z0Z0Z0Z0Z0Z0Z0Zu";

function unauthorized() {
  return NextResponse.json(
    { error: "invalid_credentials" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; name?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, 80)
      : `cli-${new Date().toISOString().slice(0, 10)}`;

  if (!email || !password) return unauthorized();

  const user = await prisma.user.findUnique({ where: { email } });

  // Always run bcrypt — even on missing user — so the response time doesn't
  // distinguish "no such email" from "wrong password".
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return unauthorized();

  const raw = `oxp_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(
    Date.now() + DEVICE_USER_CODE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const scopes = [`publish:@${user.handle}/*`];

  const token = await prisma.apiToken.create({
    data: {
      userId: user.id,
      name,
      tokenHash,
      scopes,
      expiresAt,
    },
  });

  await recordAudit({
    action: "token.create",
    target: token.id,
    actorUserId: user.id,
    metadata: { source: "cli-login", scopes },
  });

  return NextResponse.json(
    {
      ok: true,
      token: raw,
      tokenId: token.id,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
      handle: user.handle,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
