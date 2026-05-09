/**
 * POST /api/v1/me/2fa/enroll
 *   Auth: Bearer.
 *   → { secret, uri, recoveryCodes } — show ONCE; user copies into authenticator
 *     and saves recovery codes. Nothing persisted yet — call /verify next.
 *
 * POST /api/v1/me/2fa/verify
 *   Body: { secret, recoveryCodes, code }
 *   → { ok } — persists secret + bcrypt-hashed recovery codes onto the user.
 *
 * POST /api/v1/me/2fa/proof
 *   Body: { code }    (TOTP digit-string OR a recovery code)
 *   → { ok } — stamps the bearer token's `lastTwoFactorAt`.
 *     Returns 401 with `usedRecoveryCode` flag on success of recovery path.
 *
 * DELETE /api/v1/me/2fa
 *   Body: { code } — must verify before disable.
 *   → { ok } — wipes secret + codes.
 */

import { NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";
import {
  confirmEnrollment,
  disable2fa,
  generateEnrollmentSecret,
  provideProof,
} from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth.ok)
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  const out = await generateEnrollmentSecret(auth.auth.user.handle);
  return NextResponse.json(out, { status: 200 });
}
