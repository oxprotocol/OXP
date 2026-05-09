import { redirect } from "next/navigation";
import Link from "next/link";
import { AtSign } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getUserPlan, PLANS } from "@/lib/billing";
import { listUserNamespaces } from "@/lib/namespaces";
import { prisma } from "@/lib/prisma";
import { ClaimForm, ReleaseButton } from "./forms";

export const metadata = { title: "Namespaces" };

export default async function NamespacesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/dashboard/namespaces");

  const plan = await getUserPlan(me.id);
  const cap = PLANS[plan.plan].limits.maxNamespaces;
  const namespaces = await listUserNamespaces(me.id);

  // Count published extensions per namespace so users see what's "in use"
  // before trying to release.
  const counts = await prisma.extension.groupBy({
    by: ["ownerHandle"],
    where: { ownerHandle: { in: namespaces.map((n) => n.handle) } },
    _count: { _all: true },
  });
  const usage = new Map(counts.map((c) => [c.ownerHandle, c._count._all]));

  const remaining = cap === -1 ? Infinity : cap - namespaces.length;
  const canClaim = remaining > 0;

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-10">
          <div className="flex items-center gap-3 mb-3">
            <AtSign className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Namespaces"}
            </h2>
          </div>
          <h1 className="text-3xl font-black text-[#f8fafc] mb-2">
            Personal handles
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/50 max-w-2xl">
            Publish under multiple identities — your primary handle plus aliases
            for side projects, client work, or open-source orgs you front. Plan{" "}
            <span className="text-[#7DD3FC]">{plan.plan}</span> allows{" "}
            {cap === -1 ? "unlimited" : `${cap} total`}; you have{" "}
            <span className="text-[#7DD3FC]">{namespaces.length}</span>.
          </p>
        </div>
      </section>

      <section className="app-container app-shell py-8 space-y-6">
        <div className="hud-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#060a13] border-b border-[#7DD3FC]/10">
              <tr className="text-left">
                <th className="px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-[#7DD3FC]/50">
                  Handle
                </th>
                <th className="px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-[#7DD3FC]/50">
                  Type
                </th>
                <th className="px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-[#7DD3FC]/50">
                  Extensions
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {namespaces.map((n) => {
                const used = usage.get(n.handle) ?? 0;
                const isPrimary = n.kind === "primary";
                return (
                  <tr
                    key={n.handle}
                    className="border-b border-[#7DD3FC]/5 last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[#f8fafc]">
                      <Link
                        href={`/${n.handle}`}
                        className="hover:text-[#7DD3FC]"
                      >
                        @{n.handle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#f8fafc]/60 uppercase tracking-wider">
                      {isPrimary ? "primary" : "alias"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#f8fafc]/60">
                      {used}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isPrimary && used === 0 ? (
                        <ReleaseButton handle={n.handle} />
                      ) : isPrimary ? (
                        <span className="text-[10px] font-mono text-[#f8fafc]/30 uppercase">
                          locked
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-[#f8fafc]/30 uppercase">
                          in use
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="hud-card p-6">
          <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-[#7DD3FC]/70 mb-3">
            Claim a new alias
          </h3>
          {canClaim ? (
            <ClaimForm />
          ) : (
            <p className="text-sm font-mono text-[#f8fafc]/60">
              You&apos;ve hit your plan&apos;s namespace cap.{" "}
              <Link
                href="/pricing"
                className="text-[#7DD3FC] hover:text-[#BAE6FD]"
              >
                Upgrade to Pro
              </Link>{" "}
              for unlimited handles.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
