"use server";

/**
 * Dashboard server actions for personal namespace aliases.
 * Session-authenticated. The actual policy lives in `lib/namespaces.ts`.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { claimNamespace, releaseNamespace } from "@/lib/namespaces";
import { recordAudit } from "@/lib/audit";

export type NamespaceActionResult = { ok: true } | { ok: false; error: string };

export async function claimNamespaceAction(
  _prev: NamespaceActionResult | undefined,
  formData: FormData,
): Promise<NamespaceActionResult> {
  const me = await requireUser();
  const handle = String(formData.get("handle") ?? "");
  const result = await claimNamespace(me.id, handle);
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    action: "namespace.claim",
    target: `@${result.handle}`,
    actorUserId: me.id,
  });
  revalidatePath("/dashboard/namespaces");
  return { ok: true };
}

export async function releaseNamespaceAction(
  formData: FormData,
): Promise<NamespaceActionResult> {
  const me = await requireUser();
  const handle = String(formData.get("handle") ?? "");
  const ok = await releaseNamespace(me.id, handle);
  if (!ok) {
    return {
      ok: false,
      error:
        "Cannot release this namespace. Either it isn't yours, it's your primary handle, or it has published extensions.",
    };
  }
  await recordAudit({
    action: "namespace.release",
    target: `@${handle.toLowerCase().replace(/^@/, "")}`,
    actorUserId: me.id,
  });
  revalidatePath("/dashboard/namespaces");
  return { ok: true };
}
