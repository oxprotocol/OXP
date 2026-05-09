/**
 * Org admin → Audit log viewer (Phase 2).
 *
 * Teams+ surface. Lists recent privileged events scoped to this org.
 * Retention is enforced by the plan's `auditLogRetentionDays`.
 */

import Link from "next/link";
import { loadOrgContextOrRedirect, requireTeamsPlus } from "@/lib/org-auth";
import { listAuditEvents } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ handle: string }>;
}

export default async function OrgAuditPage({ params }: Props) {
  const { handle } = await params;
  const ctx = await loadOrgContextOrRedirect(handle);
  try {
    requireTeamsPlus(ctx);
  } catch {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 font-mono text-sky-200">
        <h1 className="text-2xl tracking-[0.18em] uppercase mb-4">Audit log</h1>
        <p className="text-sm text-sky-300/60 mb-6">
          Audit logs are a Teams+ feature. Upgrade your org to retain a record
          of every privileged change.
        </p>
        <Link
          href="/pricing"
          className="inline-block px-4 py-2 border border-sky-300/40 hover:bg-sky-500/10 text-xs tracking-[0.2em] uppercase"
        >
          See pricing →
        </Link>
      </main>
    );
  }

  const events = await listAuditEvents({
    orgId: ctx.org.id,
    plan: ctx.plan,
    limit: 200,
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-16 font-mono text-sky-200">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl tracking-[0.18em] uppercase">
          @{ctx.org.handle} / audit
        </h1>
        <span className="text-[10px] tracking-[0.2em] text-sky-300/50 uppercase">
          {events.length} events · {ctx.plan.toUpperCase()}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="hud-card p-8 text-center text-sm text-sky-300/60">
          No audit events recorded yet.
        </div>
      ) : (
        <div className="hud-card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-sky-500/5 text-[10px] tracking-[0.2em] uppercase text-sky-300/60">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Target</th>
                <th className="px-3 py-2 text-left">Actor</th>
                <th className="px-3 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-sky-500/10 hover:bg-sky-500/5"
                >
                  <td className="px-3 py-2 text-sky-300/70 whitespace-nowrap">
                    {e.ts.toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-3 py-2 text-sky-200">{e.action}</td>
                  <td className="px-3 py-2 text-sky-300/80 break-all">
                    {e.target}
                  </td>
                  <td className="px-3 py-2 text-sky-300/60">
                    {e.actorUserId ?? "system"}
                  </td>
                  <td className="px-3 py-2 text-sky-300/40">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-[11px] text-sky-300/40">
        Retention:{" "}
        {ctx.plan === "enterprise"
          ? "unlimited"
          : `last ${
              {
                free: 0,
                pro: 30,
                teams: 365,
                enterprise: -1,
              }[ctx.plan]
            } days`}
        .
      </p>
    </main>
  );
}
