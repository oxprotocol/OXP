"use server";

/**
 * Server actions for /auth/device. Both actions take a `userCode`
 * (form-data) and require an authenticated user.
 *
 * Approve: flips DeviceAuth.{userId, approvedAt}. The actual ApiToken is
 * minted lazily inside the /api/v1/auth/device/token poll handler so the
 * raw secret is generated as close to retrieval as possible (and never
 * round-trips through this page).
 *
 * Deny: flips DeviceAuth.deniedAt so the polling CLI sees `access_denied`.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeUserCode } from "@/lib/device-auth";

async function loadPending(userCode: string) {
  const session = await prisma.deviceAuth.findUnique({ where: { userCode } });
  if (!session) return { error: "Code not found" as const };
  if (session.consumedAt) return { error: "Already used" as const };
  if (session.expiresAt.getTime() < Date.now())
    return { error: "Expired" as const };
  if (session.deniedAt) return { error: "Already denied" as const };
  if (session.approvedAt) return { error: "Already approved" as const };
  return { session };
}

export async function approveAction(formData: FormData) {
  const me = await requireUser();
  const userCode = normalizeUserCode(String(formData.get("userCode") ?? ""));
  if (!userCode) redirect("/auth/device");

  const loaded = await loadPending(userCode);
  if ("error" in loaded) {
    redirect(`/auth/device?code=${encodeURIComponent(userCode)}`);
  }

  // If the CLI didn't request scopes, default to "publish anything this
  // user owns". Approval is per-handle so this is a safe default for the
  // common `oxp login` case.
  const scopes =
    loaded.session.requestedScopes.length > 0
      ? loaded.session.requestedScopes
      : [`publish:@${me.handle}/*`];

  await prisma.deviceAuth.update({
    where: { id: loaded.session.id },
    data: {
      userId: me.id,
      approvedAt: new Date(),
      requestedScopes: scopes,
    },
  });

  revalidatePath("/auth/device");
  redirect(`/auth/device?code=${encodeURIComponent(userCode)}`);
}

export async function denyAction(formData: FormData) {
  await requireUser();
  const userCode = normalizeUserCode(String(formData.get("userCode") ?? ""));
  if (!userCode) redirect("/auth/device");

  const loaded = await loadPending(userCode);
  if ("error" in loaded) {
    redirect(`/auth/device?code=${encodeURIComponent(userCode)}`);
  }

  await prisma.deviceAuth.update({
    where: { id: loaded.session.id },
    data: { deniedAt: new Date() },
  });

  revalidatePath("/auth/device");
  redirect(`/auth/device?code=${encodeURIComponent(userCode)}`);
}
