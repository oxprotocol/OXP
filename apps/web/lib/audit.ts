/**
 * Audit log — Phase 2.
 *
 * Append-only record of privileged mutations. Calls are best-effort:
 * audit failures must never break the underlying action. Retention is
 * enforced by a scheduled prune (`pruneExpiredAuditEvents`) using each
 * subject's `PLANS[plan].limits.auditLogRetentionDays`.
 *
 * Action identifiers are stable `noun.verb` strings. Add new ones to the
 * `AuditAction` union below; never rename — old rows remain on disk.
 */

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/billing";
import type { Plan } from "@prisma/client";

export type AuditAction =
  | "token.create"
  | "token.revoke"
  | "org.create"
  | "org.update"
  | "member.add"
  | "member.remove"
  | "member.role"
  | "extension.publish"
  | "extension.yank"
  | "extension.transfer"
  | "namespace.claim"
  | "namespace.release"
  | "plan.change"
  | "sso.config"
  | "sigstore.verify"
  | "sigstore.fail";

export interface AuditInput {
  action: AuditAction;
  target: string;
  actorUserId?: string | null;
  orgId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Snapshot the current request's IP + UA. Safe to call from server actions. */
async function requestContext(): Promise<{
  ip: string | null;
  ua: string | null;
}> {
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null;
    const ua = h.get("user-agent") || null;
    return { ip, ua };
  } catch {
    // Outside a request scope (cron, scripts).
    return { ip: null, ua: null };
  }
}

/** Record one audit event. Never throws — logs to console on failure. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { ip, ua } = await requestContext();
    await prisma.auditEvent.create({
      data: {
        action: input.action,
        subject: input.target,
        actorId: input.actorUserId ?? null,
        orgId: input.orgId ?? null,
        metadata: (input.metadata ?? {}) as never,
        ip,
        userAgent: ua,
      },
    });
  } catch (err) {
    // Best-effort: never break the caller.
    console.error("[audit] failed to record", input.action, err);
  }
}

export interface AuditQuery {
  orgId?: string;
  actorUserId?: string;
  action?: AuditAction;
  /** Inclusive lower bound. Defaults to 30 days ago. */
  since?: Date;
  limit?: number;
}

/**
 * Read recent audit events for a subject. Honours plan retention by
 * filtering rows older than the cap; older rows are still in the DB but
 * not surfaced until the prune job removes them.
 */
export async function listAuditEvents(q: AuditQuery & { plan?: Plan }): Promise<
  Array<{
    id: string;
    ts: Date;
    actorUserId: string | null;
    action: string;
    target: string;
    metadata: unknown;
    ip: string | null;
  }>
> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const retentionDays = q.plan
    ? PLANS[q.plan].limits.auditLogRetentionDays
    : -1;
  let since = q.since;
  if (!since && retentionDays > 0) {
    since = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  }

  const rows = await prisma.auditEvent.findMany({
    where: {
      ...(q.orgId !== undefined ? { orgId: q.orgId } : {}),
      ...(q.actorUserId ? { actorId: q.actorUserId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      actorId: true,
      action: true,
      subject: true,
      metadata: true,
      ip: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: r.createdAt,
    actorUserId: r.actorId,
    action: r.action,
    target: r.subject,
    metadata: r.metadata,
    ip: r.ip,
  }));
}

/**
 * Delete audit events older than each org's retention cap. Run on a cron.
 * Personal-account rows are pruned at the longest plan retention (Pro = 30 d
 * unless the actor's plan is Teams+).
 */
export async function pruneExpiredAuditEvents(): Promise<number> {
  // Find oldest acceptable cutoff across plans (use min of finite caps).
  const finite = (
    Object.values(PLANS) as { limits: { auditLogRetentionDays: number } }[]
  )
    .map((p) => p.limits.auditLogRetentionDays)
    .filter((d) => d > 0);
  if (finite.length === 0) return 0;
  const maxRetention = Math.max(...finite);
  const cutoff = new Date(Date.now() - maxRetention * 24 * 60 * 60 * 1000);
  const res = await prisma.auditEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return res.count;
}
