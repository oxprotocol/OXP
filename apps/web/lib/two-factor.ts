/**
 * Phase B.7 — TOTP 2FA.
 *
 * Three flows:
 *
 *   1. Enroll  → generate a fresh secret + 10 recovery codes.
 *                Returns the otpauth:// URI (UI renders QR client-side).
 *                Verification with one TOTP code from the authenticator
 *                persists the secret + recovery code hashes onto the user.
 *   2. Proof   → user submits a 6-digit code; verifies against the stored
 *                secret; on success the caller stamps a token row's
 *                `lastTwoFactorAt`. Used by the publish gate.
 *   3. Recover → single-use recovery code in place of a TOTP code (for
 *                lost devices). Each code is bcrypt-hashed; on consumption
 *                the matching hash is removed from the user row.
 *
 * The publish gate (`requireRecentTwoFactor`) compares
 * `ApiToken.lastTwoFactorAt` to a 10-minute window. Tokens whose owner
 * has *not* enrolled in 2FA bypass the gate — opt-in security.
 */

import { generateSecret, generateURI, verify } from "otplib";
import { compare, hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { toDataURL as qrToDataURL } from "qrcode";
import { prisma } from "@/lib/prisma";
import type { ApiToken, User } from "@prisma/client";

/** Window of acceptance for `lastTwoFactorAt` on a token. */
export const TWO_FACTOR_PROOF_TTL_MS = 10 * 60 * 1000;

/** ±1 step (30 s) clock-drift tolerance. */
const EPOCH_TOLERANCE = 1;

const ISSUER = "OXP";

/** Pure-random 10-character alphanumeric recovery code (uppercase). */
function newRecoveryCode(): string {
  const bytes = randomBytes(8);
  // Crockford-ish base32 alphabet — no I/L/O/0/1 to avoid OCR confusion.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[bytes[i % bytes.length] % alphabet.length];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export interface EnrollmentSecret {
  secret: string;
  /** otpauth://totp/OXP:<handle>?secret=…&issuer=OXP — feed into a QR. */
  uri: string;
  /** Pre-rendered QR (PNG data URL) of the otpauth URI. */
  qrDataUrl: string;
  /** Plain-text recovery codes shown ONCE to the user. */
  recoveryCodes: string[];
}

/** Step 1 of enrollment: never persisted server-side until `confirmEnrollment`. */
export async function generateEnrollmentSecret(
  handle: string,
): Promise<EnrollmentSecret> {
  const secret = generateSecret();
  const uri = generateURI({ issuer: ISSUER, label: handle, secret });
  const recoveryCodes = Array.from({ length: 10 }, newRecoveryCode);
  const qrDataUrl = await qrToDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
    color: { dark: "#0a0f1c", light: "#f8fafc" },
  });
  return { secret, uri, qrDataUrl, recoveryCodes };
}

/** Step 2: user proved possession. Persist the secret + hashed codes. */
export async function confirmEnrollment(input: {
  userId: string;
  secret: string;
  token: string;
  recoveryCodes: string[];
}): Promise<{ ok: boolean; reason?: string }> {
  const result = await verify({
    secret: input.secret,
    token: input.token,
    epochTolerance: EPOCH_TOLERANCE,
  });
  if (!result.valid) {
    return { ok: false, reason: "invalid totp code" };
  }
  const recoveryCodesHash = await Promise.all(
    input.recoveryCodes.map((c) => hash(c, 10)),
  );
  await prisma.user.update({
    where: { id: input.userId },
    data: {
      totpSecret: input.secret,
      totpEnrolledAt: new Date(),
      recoveryCodesHash,
    },
  });
  return { ok: true };
}

/** Disable 2FA — wipes secret + recovery codes. Caller must re-auth first. */
export async function disable2fa(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnrolledAt: null, recoveryCodesHash: [] },
  });
}

/**
 * Verify a 6-digit TOTP code OR a recovery code. On success, stamps the
 * given token's `lastTwoFactorAt`. Recovery codes are single-use.
 */
export async function provideProof(input: {
  userId: string;
  tokenId: string;
  code: string;
}): Promise<{ ok: boolean; reason?: string; usedRecoveryCode?: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { totpSecret: true, recoveryCodesHash: true },
  });
  if (!user || !user.totpSecret) {
    return { ok: false, reason: "2fa not enrolled" };
  }
  const trimmed = input.code.trim();

  // Try TOTP first (cheap, common path).
  if (/^\d{6}$/.test(trimmed)) {
    const result = await verify({
      secret: user.totpSecret,
      token: trimmed,
      epochTolerance: EPOCH_TOLERANCE,
    });
    if (result.valid) {
      await stampToken(input.tokenId);
      return { ok: true };
    }
  }

  // Recovery code path.
  for (let i = 0; i < user.recoveryCodesHash.length; i++) {
    if (await compare(trimmed, user.recoveryCodesHash[i])) {
      const remaining = [...user.recoveryCodesHash];
      remaining.splice(i, 1);
      await prisma.user.update({
        where: { id: input.userId },
        data: { recoveryCodesHash: remaining },
      });
      await stampToken(input.tokenId);
      return { ok: true, usedRecoveryCode: true };
    }
  }

  return { ok: false, reason: "code did not match" };
}

async function stampToken(tokenId: string): Promise<void> {
  await prisma.apiToken.update({
    where: { id: tokenId },
    data: { lastTwoFactorAt: new Date() },
  });
}

/** Publish-gate predicate. Bypassed for users with no enrolled 2FA. */
export function tokenSatisfies2faGate(
  user: Pick<User, "totpSecret">,
  token: Pick<ApiToken, "lastTwoFactorAt">,
  now: number = Date.now(),
): { ok: boolean; reason?: string } {
  if (!user.totpSecret) return { ok: true }; // not enrolled → opt-in
  if (!token.lastTwoFactorAt) {
    return { ok: false, reason: "two-factor proof required on this token" };
  }
  const age = now - token.lastTwoFactorAt.getTime();
  if (age > TWO_FACTOR_PROOF_TTL_MS) {
    return {
      ok: false,
      reason: `two-factor proof expired (${Math.round(age / 60000)} min old, max ${
        TWO_FACTOR_PROOF_TTL_MS / 60000
      })`,
    };
  }
  return { ok: true };
}
