"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut as nextAuthSignOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RESERVED_HANDLES } from "@/lib/owners";
import { findReservedBrand } from "@/lib/reserved-handles";
import { consume, clientIpFromHeaders, LIMITS } from "@/lib/rate-limit";
import { ensureFreeSubscription } from "@/lib/billing";
import {
  sendEmail,
  welcomeEmail,
  emailVerificationEmail,
  passwordResetEmail,
} from "@/lib/email";
import {
  issueEmailVerification,
  issuePasswordReset,
  consumePasswordReset,
} from "@/lib/email-tokens";

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      field?: "email" | "password" | "handle" | "displayName";
    };

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signInWithCredentials(
  _prev: AuthResult | undefined,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address.", field: "email" };
  }
  if (password.length < 1) {
    return { ok: false, error: "Password is required.", field: "password" };
  }

  // Pre-check email verification so we can show a helpful message instead
  // of the generic "invalid credentials". We still let the actual signIn
  // call enforce it as the source of truth.
  const userRow = await prisma.user.findUnique({ where: { email } });
  if (userRow && !userRow.emailVerified) {
    return {
      ok: false,
      error:
        "Verify your email first. We sent a link when you signed up — check your inbox or request a new one.",
      field: "email",
    };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: true,
      redirectTo: next,
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    if (err instanceof AuthError) {
      return { ok: false, error: "Invalid email or password." };
    }
    throw err;
  }

  return { ok: true };
}

export async function signUp(
  _prev: AuthResult | undefined,
  formData: FormData,
): Promise<AuthResult> {
  // Phase B.6 — per-IP signup rate limit. Cheap pre-check before any DB work.
  const ip = clientIpFromHeaders(await headers());
  const rl = consume(
    `signup:${ip}`,
    LIMITS.signup.limit,
    LIMITS.signup.windowMs,
  );
  if (!rl.ok) {
    return {
      ok: false,
      error: `Too many signup attempts. Try again in ${Math.ceil(
        rl.retryAfterMs / 1000 / 60,
      )} minutes.`,
    };
  }

  const handle = String(formData.get("handle") ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      error: "Handle must be 1–40 chars: lowercase letters, digits, hyphens.",
      field: "handle",
    };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, error: "That handle is reserved.", field: "handle" };
  }
  // Phase B.2 — brand-protection list. Verified publishers (Phase B.1) will
  // be able to claim these via DNS proof; until then, hard-block at signup.
  const brand = findReservedBrand(handle);
  if (brand) {
    return {
      ok: false,
      error: `@${handle} is reserved for ${brand.domain}. If you operate ${brand.domain}, contact support to verify ownership.`,
      field: "handle",
    };
  }
  if (!displayName || displayName.length > 80) {
    return {
      ok: false,
      error: "Display name is required.",
      field: "displayName",
    };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address.", field: "email" };
  }
  if (password.length < 8) {
    return {
      ok: false,
      error: "Password must be at least 8 characters.",
      field: "password",
    };
  }

  const [byHandle, byEmail] = await Promise.all([
    prisma.user.findUnique({ where: { handle } }),
    prisma.user.findUnique({ where: { email } }),
  ]);
  if (byHandle) {
    return {
      ok: false,
      error: "That handle is already taken.",
      field: "handle",
    };
  }
  if (byEmail) {
    return {
      ok: false,
      error: "An account with that email already exists.",
      field: "email",
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const avatarSeed =
    displayName
      .split(/\s+/)
      .map((s) => s[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || handle.slice(0, 2).toUpperCase();

  const created = await prisma.user.create({
    data: {
      handle,
      email,
      displayName,
      avatarSeed,
      passwordHash,
      // Credentials accounts must verify before sign-in. Stays null until
      // the user clicks the verification link.
      emailVerified: null,
    },
  });

  // Every new account starts on the Free plan. Idempotent — safe even if a
  // future migration backfills subscriptions for existing rows.
  await ensureFreeSubscription(created.id);

  // Issue + send the verification email. Failures don't block signup
  // (the user can request a fresh link from /verify/sent).
  try {
    const token = await issueEmailVerification({
      userId: created.id,
      email,
    });
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://oxp.sh";
    void sendEmail({
      to: email,
      template: emailVerificationEmail({
        handle,
        verifyUrl: `${appUrl}/verify/${encodeURIComponent(token)}`,
      }),
      tag: "verify-email",
    });
  } catch (err) {
    console.error("[signup] verification email failed:", err);
  }

  // Redirect to the "check your inbox" page. The welcome email is sent
  // *after* verification (in /verify route handler), not here — so
  // unverified accounts don't get billing/marketing copy.
  redirect(`/verify/sent?email=${encodeURIComponent(email)}`);
}

export async function signOut(): Promise<void> {
  await nextAuthSignOut({ redirectTo: "/" });
}

/** Next throws a special redirect error from server actions; bubble it. */
function isRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://oxp.sh"
  );
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

/**
 * Resend a verification email. Always returns { ok: true } whether or not
 * the address exists, so attackers can't enumerate accounts. Rate-limited
 * per IP.
 */
export async function resendVerification(
  _prev: SimpleResult | undefined,
  formData: FormData,
): Promise<SimpleResult> {
  const ip = clientIpFromHeaders(await headers());
  const rl = consume(
    `verify-resend:${ip}`,
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

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerified) {
    try {
      const token = await issueEmailVerification({
        userId: user.id,
        email: user.email,
      });
      void sendEmail({
        to: email,
        template: emailVerificationEmail({
          handle: user.handle,
          verifyUrl: `${appUrl()}/verify/${encodeURIComponent(token)}`,
        }),
        tag: "verify-email",
      });
    } catch (err) {
      console.error("[resendVerification] failed:", err);
    }
  }

  return { ok: true };
}

/**
 * Issue a password-reset token. Always succeeds from the caller's
 * perspective so we don't leak which emails are registered.
 */
export async function requestPasswordReset(
  _prev: SimpleResult | undefined,
  formData: FormData,
): Promise<SimpleResult> {
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

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    try {
      const token = await issuePasswordReset({ userId: user.id });
      void sendEmail({
        to: email,
        template: passwordResetEmail({
          handle: user.handle,
          resetUrl: `${appUrl()}/reset/${encodeURIComponent(token)}`,
        }),
        tag: "password-reset",
      });
    } catch (err) {
      console.error("[requestPasswordReset] failed:", err);
    }
  }

  return { ok: true };
}

/**
 * Consume a password-reset token and set a new password. Returns a
 * generic error on token issues so we don't reveal token state.
 */
export async function resetPassword(
  _prev: SimpleResult | undefined,
  formData: FormData,
): Promise<SimpleResult> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!token) return { ok: false, error: "Missing reset token." };
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const newHash = await bcrypt.hash(password, 12);
  const result = await consumePasswordReset({
    raw: token,
    newPasswordHash: newHash,
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        "This reset link is invalid or expired. Request a fresh one from /forgot.",
    };
  }
  redirect("/signin?reset=1");
}
