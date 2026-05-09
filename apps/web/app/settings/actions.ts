"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signOut as nextAuthSignOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { issuePasswordReset } from "@/lib/email-tokens";
import {
  sendEmail,
  passwordResetEmail,
  emailVerificationEmail,
} from "@/lib/email";
import { issueEmailVerification } from "@/lib/email-tokens";
import { consume, clientIpFromHeaders, LIMITS } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

export type Result =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const URL_RE = /^https?:\/\/[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ────────────────────────────────────────────────────────────── */
/*  Profile fields                                                */
/* ────────────────────────────────────────────────────────────── */

export async function updateProfile(
  _prev: Result | undefined,
  formData: FormData,
): Promise<Result> {
  const me = await requireUser();

  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();

  if (!displayName || displayName.length > 80) {
    return { ok: false, error: "Display name is required (max 80 chars)." };
  }
  if (bio.length > 280) {
    return { ok: false, error: "Bio must be 280 characters or fewer." };
  }
  if (location.length > 80) {
    return { ok: false, error: "Location must be 80 characters or fewer." };
  }
  if (website && !URL_RE.test(website)) {
    return {
      ok: false,
      error: "Website must start with http:// or https://.",
    };
  }

  // Recompute initials only when the display name actually changed —
  // avatarSeed is the fallback chip when no uploaded avatar is present.
  const avatarSeed =
    displayName
      .split(/\s+/)
      .map((s) => s[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || me.handle.slice(0, 2).toUpperCase();

  await prisma.user.update({
    where: { id: me.id },
    data: {
      displayName,
      avatarSeed,
      bio: bio || null,
      location: location || null,
      website: website || null,
    },
  });

  revalidatePath("/settings");
  revalidatePath(`/${me.handle}`);
  return { ok: true, message: "Profile saved." };
}

/* ────────────────────────────────────────────────────────────── */
/*  Password change (signed-in)                                   */
/* ────────────────────────────────────────────────────────────── */

export async function changePassword(
  _prev: Result | undefined,
  formData: FormData,
): Promise<Result> {
  const me = await requireUser();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < 8) {
    return {
      ok: false,
      error: "New password must be at least 8 characters.",
    };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "Passwords do not match." };
  }
  if (currentPassword === newPassword) {
    return {
      ok: false,
      error: "New password must differ from the current one.",
    };
  }

  const ip = clientIpFromHeaders(await headers());
  const rl = consume(
    `pw-change:${ip}:${me.id}`,
    LIMITS.signup.limit,
    LIMITS.signup.windowMs,
  );
  if (!rl.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${Math.ceil(
        rl.retryAfterMs / 1000 / 60,
      )} minutes.`,
    };
  }

  const row = await prisma.user.findUnique({
    where: { id: me.id },
    select: { passwordHash: true, email: true, handle: true },
  });
  if (!row) return { ok: false, error: "Account not found." };

  const ok = await bcrypt.compare(currentPassword, row.passwordHash);
  if (!ok) {
    return { ok: false, error: "Current password is incorrect." };
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash: newHash },
  });

  // Best-effort audit; failures must not block the change.
  void recordAudit({
    action: "token.revoke",
    target: `user:${me.id}`,
    actorUserId: me.id,
    metadata: { kind: "password.change" },
  }).catch(() => {});

  return { ok: true, message: "Password updated." };
}

/* ────────────────────────────────────────────────────────────── */
/*  Email-link "send me a reset" — useful on shared devices       */
/* ────────────────────────────────────────────────────────────── */

export async function sendPasswordResetLinkToSelf(): Promise<Result> {
  const me = await requireUser();
  const ip = clientIpFromHeaders(await headers());
  const rl = consume(
    `pw-reset:${ip}`,
    LIMITS.signup.limit,
    LIMITS.signup.windowMs,
  );
  if (!rl.ok) {
    return {
      ok: false,
      error: `Too many requests. Try again in ${Math.ceil(
        rl.retryAfterMs / 1000 / 60,
      )} minutes.`,
    };
  }

  try {
    const token = await issuePasswordReset({ userId: me.id });
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://oxp.sh";
    void sendEmail({
      to: me.email,
      template: passwordResetEmail({
        handle: me.handle,
        resetUrl: `${appUrl}/reset/${encodeURIComponent(token)}`,
      }),
      tag: "password-reset",
    });
  } catch (err) {
    console.error("[settings] sendPasswordResetLinkToSelf failed:", err);
    return { ok: false, error: "Could not send reset email." };
  }

  return { ok: true, message: `Reset link sent to ${me.email}.` };
}

/* ────────────────────────────────────────────────────────────── */
/*  Email change — re-verification flow                           */
/* ────────────────────────────────────────────────────────────── */

export async function changeEmail(
  _prev: Result | undefined,
  formData: FormData,
): Promise<Result> {
  const me = await requireUser();
  const newEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!EMAIL_RE.test(newEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (newEmail === me.email) {
    return { ok: false, error: "That is already your email." };
  }
  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken) {
    return { ok: false, error: "That email is already in use." };
  }

  // Update email but immediately mark unverified — user must click the link.
  await prisma.user.update({
    where: { id: me.id },
    data: { email: newEmail, emailVerified: null },
  });

  try {
    const token = await issueEmailVerification({
      userId: me.id,
      email: newEmail,
    });
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://oxp.sh";
    void sendEmail({
      to: newEmail,
      template: emailVerificationEmail({
        handle: me.handle,
        verifyUrl: `${appUrl}/verify/${encodeURIComponent(token)}`,
      }),
      tag: "verify-email",
    });
  } catch (err) {
    console.error("[settings] verification email failed:", err);
  }

  // The session is now stale (unverified email); force a fresh sign-in.
  await nextAuthSignOut({ redirect: false });
  redirect(
    `/verify/sent?email=${encodeURIComponent(newEmail)}&from=email-change`,
  );
}
