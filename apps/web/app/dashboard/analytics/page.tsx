import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, BarChart3, Lock, TrendingUp, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getOrgsForUser } from "@/lib/registry";
import { getUserPlan } from "@/lib/billing";
import { getInstallAnalytics } from "@/lib/analytics";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/dashboard/analytics");

  const plan = await getUserPlan(me.id).catch(() => null);
  const isPaid = plan ? plan.plan !== "free" : false;

  if (!isPaid) {
    return (
      <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
        <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
          <div className="app-container app-shell py-12">
            <div className="flex items-center gap-3 mb-3">
              <BarChart3 className="w-4 h-4 text-[#7DD3FC]/40" />
              <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                {"// Dashboard / Analytics"}
              </h2>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc] mb-2">
              Install analytics
            </h1>
            <p className="text-sm font-mono text-[#f8fafc]/40">
              Per-extension installs, daily trend, editor breakdown, unique
              users.
            </p>
          </div>
        </section>
        <section className="app-container app-shell py-12">
          <div className="hud-card hud-corners p-10 max-w-2xl mx-auto text-center flex flex-col items-center gap-4">
            <div className="p-3 rounded-full border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 text-[#7DD3FC]">
              <Lock className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-black text-[#f8fafc]">
              Analytics ship with Pro.
            </h2>
            <p className="text-sm font-mono text-[#f8fafc]/50 max-w-md leading-relaxed">
              Free accounts can publish unlimited public extensions. Pro adds
              install counts, daily trend, editor breakdown, and unique users
              for every package you own.
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
            >
              See pricing
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const orgs = getOrgsForUser(me.id);
  const handles = [me.handle, ...orgs.map((o) => o.handle)];
  const data = await getInstallAnalytics(handles);

  const peak = Math.max(1, ...data.daily.map((d) => d.count));

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-12">
          <div className="flex items-center gap-3 mb-3">
            <BarChart3 className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Dashboard / Analytics"}
            </h2>
          </div>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc] mb-2">
                Install analytics
              </h1>
              <p className="text-sm font-mono text-[#f8fafc]/40">
                {data.extensionIds.length} extensions tracked ·{" "}
                {data.totals.uniqueUsers.toLocaleString()} unique users
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="app-container app-shell py-12">
        {/* ── Stat tiles ───────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            {
              Icon: Activity,
              label: "Total installs",
              value: data.totals.total,
            },
            {
              Icon: TrendingUp,
              label: "Last 30 days",
              value: data.totals.last30d,
            },
            {
              Icon: TrendingUp,
              label: "Last 7 days",
              value: data.totals.last7d,
            },
            {
              Icon: Users,
              label: "Unique users",
              value: data.totals.uniqueUsers,
            },
          ].map(({ Icon, label, value }) => (
            <div key={label} className="hud-card hud-corners p-5">
              <div className="flex items-center gap-2 mb-3">
                <Icon className="w-3.5 h-3.5 text-[#7DD3FC]/60" />
                <span className="text-[10px] font-mono font-bold tracking-[0.18em] text-[#7DD3FC]/60 uppercase">
                  {label}
                </span>
              </div>
              <div className="text-3xl font-black text-[#f8fafc]">
                {value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* ── Daily trend (CSS bar chart, no JS deps) ──────────── */}
        <div className="hud-card hud-corners p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-3.5 h-3.5 text-[#7DD3FC]/60" />
            <span className="text-[10px] font-mono font-bold tracking-[0.18em] text-[#7DD3FC]/60 uppercase">
              Daily installs · last 30 days
            </span>
          </div>
          <div className="flex items-end gap-1 h-40">
            {data.daily.map((d) => {
              const h = Math.round((d.count / peak) * 100);
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.count}`}
                  className="flex-1 bg-[#7DD3FC]/20 hover:bg-[#7DD3FC]/60 transition-colors rounded-t"
                  style={{ height: `${Math.max(2, h)}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-[9px] font-mono text-[#7DD3FC]/40 tracking-wider">
            <span>{data.daily[0]?.date}</span>
            <span>{data.daily[data.daily.length - 1]?.date}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Per-extension table ────────────────────────────── */}
          <div className="hud-card hud-corners p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-3.5 h-3.5 text-[#7DD3FC]/60" />
              <span className="text-[10px] font-mono font-bold tracking-[0.18em] text-[#7DD3FC]/60 uppercase">
                Top extensions
              </span>
            </div>
            {data.perExtension.length === 0 ? (
              <p className="text-sm font-mono text-[#f8fafc]/40">
                No installs yet. Publish an extension and share it.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.perExtension.slice(0, 10).map((e) => (
                  <li
                    key={e.extensionId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <Link
                      href={`/${e.ownerHandle}/${e.slug}`}
                      className="text-[#f8fafc]/80 hover:text-[#7DD3FC] truncate"
                    >
                      {e.title}
                    </Link>
                    <div className="flex items-center gap-3 font-mono text-xs shrink-0">
                      <span className="text-[#7DD3FC]/60">
                        {e.last30d.toLocaleString()} / 30d
                      </span>
                      <span className="text-[#f8fafc]/80 font-bold">
                        {e.total.toLocaleString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Editor breakdown ───────────────────────────────── */}
          <div className="hud-card hud-corners p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-3.5 h-3.5 text-[#7DD3FC]/60" />
              <span className="text-[10px] font-mono font-bold tracking-[0.18em] text-[#7DD3FC]/60 uppercase">
                Editor breakdown
              </span>
            </div>
            {data.editors.length === 0 ? (
              <p className="text-sm font-mono text-[#f8fafc]/40">
                No installs yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.editors.map((e) => {
                  const pct = Math.round(
                    (e.count / Math.max(1, data.totals.total)) * 100,
                  );
                  return (
                    <li key={e.editor}>
                      <div className="flex justify-between text-xs font-mono mb-1">
                        <span className="text-[#f8fafc]/80 capitalize">
                          {e.editor}
                        </span>
                        <span className="text-[#7DD3FC]/60">
                          {e.count.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#7DD3FC]/10 rounded overflow-hidden">
                        <div
                          className="h-full bg-[#7DD3FC]/60 rounded"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
