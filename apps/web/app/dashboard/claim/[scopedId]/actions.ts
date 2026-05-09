"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  evaluateClaim,
  loadCallerSignals,
  parseScopedId,
} from "@/lib/vsx-claim";

/**
 * Server action — atomically transfers an Extension from its synthetic
 * VSX placeholder owner to the calling user. Only runs when the caller
 * is fully eligible per `evaluateClaim`. Reserved-brand and
 * ambiguous-source listings are NOT routed to manual review; they fall
 * through to the on-page DNS-TXT instructions and the user retries
 * after verifying their domain in /dashboard/security.
 */
export async function performClaim(scopedId: string): Promise<void> {
  const me = await getCurrentUser();
  if (!me)
    redirect(`/signin?next=/dashboard/claim/${encodeURIComponent(scopedId)}`);

  const ctx = parseScopedId(scopedId);
  if (!ctx) redirect("/dashboard?claim_error=invalid");

  const signals = await loadCallerSignals(me.handle, me.id);
  const verdict = await evaluateClaim({
    ctx,
    userId: me.id,
    callerGithubLogin: signals.githubLogin,
    callerLevel: signals.level,
    callerDomains: signals.domains,
  });

  if (verdict.kind !== "ok") {
    redirect(
      `/dashboard/claim/${encodeURIComponent(scopedId)}?denied=${verdict.kind}`,
    );
  }

  const ext = await prisma.extension.findUnique({
    where: {
      ownerHandle_slug: { ownerHandle: ctx.ownerHandle, slug: ctx.slug },
    },
    select: { id: true, ownerHandle: true, ownerId: true },
  });
  if (!ext) redirect("/dashboard?claim_error=missing");

  const previousOwnerHandle = ext.ownerHandle;
  const previousOwnerId = ext.ownerId;

  await prisma.$transaction([
    prisma.extension.update({
      where: { id: ext.id },
      data: {
        ownerHandle: me.handle,
        ownerId: me.id,
        ownerKind: "user",
      },
    }),
    // Keep the old `@vsx-<ns>/<slug>` URL resolvable via redirect.
    prisma.extensionAlias.upsert({
      where: { alias: `${previousOwnerHandle}/${ctx.slug}` },
      create: {
        alias: `${previousOwnerHandle}/${ctx.slug}`,
        extensionId: ext.id,
        ownerHandle: me.handle,
        slug: ctx.slug,
      },
      update: {
        extensionId: ext.id,
        ownerHandle: me.handle,
        slug: ctx.slug,
      },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: me.id,
        action: "vsx.listing.claimed",
        subject: `extension:${ext.id}`,
        metadata: {
          previousOwnerHandle,
          previousOwnerId,
          newOwnerHandle: me.handle,
          newOwnerId: me.id,
          reason: verdict.reason,
        },
      },
    }),
  ]);

  redirect(
    `/${me.handle}/${ctx.slug}?claimed=1&from=${encodeURIComponent(previousOwnerHandle)}`,
  );
}
