/**
 * Email verification + password reset token primitives.
 *
 * Tokens are 32 random bytes, base64url-encoded (43 chars). The DB only
 * stores SHA-256(token) — the raw value lives only in the email link, so a
 * leaked DB dump can't be replayed against /verify or /reset endpoints.
 */
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TTL_MS = 60 * 60 * 1000; //  1h

function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/* ─── Email verification ───────────────────────────────────────────── */

export async function issueEmailVerification(args: {
  userId: string;
  email: string;
}): Promise<string> {
  const { raw, hash } = mintToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: args.userId,
      email: args.email,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });
  return raw;
}

export type ConsumeVerificationResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not-found" | "expired" | "already-consumed" };

export async function consumeEmailVerification(
  raw: string,
): Promise<ConsumeVerificationResult> {
  const hash = hashToken(raw);
  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hash },
  });
  if (!row) return { ok: false, reason: "not-found" };
  if (row.consumedAt) return { ok: false, reason: "already-consumed" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: row.userId },
      data: { emailVerified: new Date() },
    }),
  ]);
  return { ok: true, userId: row.userId };
}

/* ─── Password reset ───────────────────────────────────────────────── */

export async function issuePasswordReset(args: {
  userId: string;
}): Promise<string> {
  // Invalidate any outstanding tokens for this user — only the freshest
  // link is usable, which keeps the surface area for replay tiny.
  await prisma.passwordResetToken.updateMany({
    where: { userId: args.userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const { raw, hash } = mintToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: args.userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  return raw;
}

export type ConsumeResetResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not-found" | "expired" | "already-consumed" };

export async function lookupPasswordReset(
  raw: string,
): Promise<ConsumeResetResult> {
  const hash = hashToken(raw);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hash },
  });
  if (!row) return { ok: false, reason: "not-found" };
  if (row.consumedAt) return { ok: false, reason: "already-consumed" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId };
}

export async function consumePasswordReset(args: {
  raw: string;
  newPasswordHash: string;
}): Promise<ConsumeResetResult> {
  const probe = await lookupPasswordReset(args.raw);
  if (!probe.ok) return probe;
  const hash = hashToken(args.raw);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hash },
  });
  if (!row) return { ok: false, reason: "not-found" };
  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: args.newPasswordHash },
    }),
  ]);
  return { ok: true, userId: row.userId };
}
