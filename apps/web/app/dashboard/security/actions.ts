"use server";

/**
 * Phase B.7 — TOTP 2FA dashboard server actions.
 * Session-authenticated. The CLI uses /api/v1/me/2fa/proof with bearer auth.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  confirmEnrollment,
  disable2fa,
  generateEnrollmentSecret,
  type EnrollmentSecret,
} from "@/lib/two-factor";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import { verify } from "otplib";
import {
  challengeHost,
  challengeRecord,
  checkDnsChallenge,
  createDnsChallenge,
  isValidDomain,
} from "@/lib/publisher-verification";
import { recomputePublisherLevel } from "@/lib/publisher-level";

export type StartEnrollmentResult =
  | { ok: true; enrollment: EnrollmentSecret }
  | { ok: false; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function startEnrollment(): Promise<StartEnrollmentResult> {
  const me = await requireUser();
  const existing = await prisma.user.findUnique({
    where: { id: me.id },
    select: { totpEnrolledAt: true },
  });
  if (existing?.totpEnrolledAt) {
    return { ok: false, error: "2FA is already enabled. Disable it first." };
  }
  return { ok: true, enrollment: await generateEnrollmentSecret(me.handle) };
}

export async function verifyEnrollment(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireUser();
  const secret = String(formData.get("secret") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const recoveryCodesRaw = String(formData.get("recoveryCodes") ?? "");
  if (!secret || !code || !recoveryCodesRaw) {
    return { ok: false, error: "Missing fields." };
  }
  const recoveryCodes = recoveryCodesRaw.split(",").filter(Boolean);
  if (recoveryCodes.length === 0) {
    return { ok: false, error: "Recovery codes missing." };
  }
  const result = await confirmEnrollment({
    userId: me.id,
    secret,
    token: code,
    recoveryCodes,
  });
  if (!result.ok) {
    return { ok: false, error: result.reason ?? "Verification failed." };
  }
  revalidatePath("/dashboard/security");
  return { ok: true };
}

export async function disableTwoFactor(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireUser();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { ok: false, error: "Code required." };

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { totpSecret: true, recoveryCodesHash: true },
  });
  if (!user?.totpSecret) {
    return { ok: false, error: "2FA is not enabled." };
  }

  // Try TOTP first.
  let verified = false;
  if (/^\d{6}$/.test(code)) {
    const r = await verify({
      secret: user.totpSecret,
      token: code,
      epochTolerance: 1,
    });
    verified = r.valid;
  }
  // Recovery code fallback.
  if (!verified) {
    for (const hash of user.recoveryCodesHash) {
      if (await compare(code, hash)) {
        verified = true;
        break;
      }
    }
  }
  if (!verified) {
    return { ok: false, error: "Invalid code." };
  }
  await disable2fa(me.id);
  revalidatePath("/dashboard/security");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Publisher verification (Level 3 · Domain) — session-authenticated.
// The CLI / API equivalents live under /api/v1/publishers/[handle]/...
// ─────────────────────────────────────────────────────────────────────────

export type StartDomainResult =
  | {
      ok: true;
      verification: {
        id: string;
        target: string;
        host: string;
        expectedRecord: string;
        expiresAt: string;
        status: string;
      };
    }
  | { ok: false; error: string };

export async function startDomainVerification(
  _prev: StartDomainResult | undefined,
  formData: FormData,
): Promise<StartDomainResult> {
  const me = await requireUser();
  const raw = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase();
  // Accept user-pasted URLs by stripping scheme/path.
  const domain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  if (!domain) return { ok: false, error: "Enter a domain." };
  if (!isValidDomain(domain)) {
    return {
      ok: false,
      error: `"${domain}" is not a valid apex domain. Use e.g. acme.com.`,
    };
  }
  try {
    const v = await createDnsChallenge({
      handle: me.handle,
      domain,
      createdByUserId: me.id,
    });
    revalidatePath("/dashboard/security");
    return {
      ok: true,
      verification: {
        id: v.id,
        target: v.target,
        host: challengeHost(v.target),
        expectedRecord: challengeRecord(v.token),
        expiresAt: v.expiresAt.toISOString(),
        status: v.status,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type DomainCheckResult =
  | {
      ok: true;
      status: string;
      verifiedAt: string | null;
      observedRecords: string[];
    }
  | {
      ok: false;
      error: string;
      status?: string;
      observedRecords?: string[];
    };

export async function runDomainCheck(
  _prev: DomainCheckResult | undefined,
  formData: FormData,
): Promise<DomainCheckResult> {
  const me = await requireUser();
  const id = String(formData.get("verificationId") ?? "");
  if (!id) return { ok: false, error: "Missing verification id." };

  const row = await prisma.publisherVerification.findUnique({
    where: { id },
    select: { id: true, handle: true },
  });
  if (!row || row.handle !== me.handle.toLowerCase()) {
    return { ok: false, error: "Verification not found." };
  }

  const result = await checkDnsChallenge(id);
  if (result.ok) {
    await recomputePublisherLevel(me.handle).catch(() => {});
    revalidatePath("/dashboard/security");
    return {
      ok: true,
      status: result.verification.status,
      verifiedAt: result.verification.verifiedAt?.toISOString() ?? null,
      observedRecords: result.observedRecords,
    };
  }
  return {
    ok: false,
    error:
      result.verification.reason ??
      `TXT record not found at ${challengeHost(result.verification.target)}.`,
    status: result.verification.status,
    observedRecords: result.observedRecords,
  };
}

export async function revokeDomainVerification(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireUser();
  const id = String(formData.get("verificationId") ?? "");
  if (!id) return { ok: false, error: "Missing verification id." };

  const row = await prisma.publisherVerification.findUnique({
    where: { id },
    select: { id: true, handle: true },
  });
  if (!row || row.handle !== me.handle.toLowerCase()) {
    return { ok: false, error: "Verification not found." };
  }
  await prisma.publisherVerification.update({
    where: { id },
    data: { status: "revoked", revokedAt: new Date() },
  });
  await recomputePublisherLevel(me.handle).catch(() => {});
  revalidatePath("/dashboard/security");
  return { ok: true };
}
