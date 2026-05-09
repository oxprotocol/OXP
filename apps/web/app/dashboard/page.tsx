import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  Box,
  Download,
  Eye,
  EyeOff,
  GitCommit,
  KeyRound,
  Plus,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getExtensionsByOwner, getOrgsForUser } from "@/lib/registry";
import { getExtensionsByOwnerDb } from "@/lib/registry-db";
import { getPublisherTrust } from "@/lib/publisher-level";
import { getUserPlan } from "@/lib/billing";
import { listUserOrgs } from "@/lib/orgs";
import { VerifyNudge } from "./VerifyNudge";
import { BandwidthCard } from "./BandwidthCard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ claim?: string; upgraded?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  // Legacy `?claim=@vsx-foo/bar` links route to the dedicated claim page.
  if (sp.claim) {
    redirect(`/dashboard/claim/${encodeURIComponent(sp.claim)}`);
  }
  const upgradedPlan =
    sp.upgraded === "pro" || sp.upgraded === "teams" ? sp.upgraded : null;

  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/dashboard");

  const seedMine = getExtensionsByOwner(me.handle);
  const dbMine = await getExtensionsByOwnerDb(me.handle).catch(() => []);
  const orgs = getOrgsForUser(me.id);
  const dbOrgs = await listUserOrgs(me.id).catch(() => []);
  const orgExts = [
    ...orgs.flatMap((o) => getExtensionsByOwner(o.handle)),
    ...(
      await Promise.all(
        dbOrgs.map((o) => getExtensionsByOwnerDb(o.handle).catch(() => [])),
      )
    ).flat(),
  ];
  const byKey = new Map<string, (typeof seedMine)[number]>();
  for (const e of [...seedMine, ...orgExts, ...dbMine])
    byKey.set(`${e.ownerHandle}/${e.slug}`, e);
  const all = Array.from(byKey.values());
  const trust = await getPublisherTrust(me.handle).catch(() => null);
  const planInfo = await getUserPlan(me.id).catch(() => null);

  const totalDownloads = all.length; // placeholder count
  const totalStars = all.reduce((acc, e) => acc + e.stars, 0);

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {upgradedPlan ? (
        <section className="border-b border-[#7DD3FC]/30 bg-[#7DD3FC]/5">
          <div className="app-container app-shell py-4 flex items-center gap-3 flex-wrap">
            <ShieldCheck className="w-4 h-4 text-[#7DD3FC]" />
            <p className="text-sm font-mono text-[#f8fafc]">
              You’re now on{" "}
              <strong className="text-[#7DD3FC]">
                {upgradedPlan === "pro" ? "Pro" : "Teams"}
              </strong>
              . Webhook activation may take a few seconds — refresh{" "}
              <Link
                href="/dashboard/billing"
                className="underline decoration-dotted hover:text-[#7DD3FC]"
              >
                billing
              </Link>{" "}
              if it hasn’t flipped yet.
            </p>
          </div>
        </section>
      ) : null}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-12">
          <div className="flex items-center gap-3 mb-3">
            <Activity className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Dashboard"}
            </h2>
          </div>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc] mb-2">
                Welcome back, {me.displayName.split(" ")[0]}.
              </h1>
              <p className="text-sm font-mono text-[#f8fafc]/40">
                {all.length} extensions · {totalDownloads} active ·{" "}
                {totalStars.toLocaleString()} stars
              </p>
            </div>
            <Link
              href="/new"
              className="inline-flex items-center gap-2 px-5 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
            >
              <Plus className="w-4 h-4" /> New Extension
            </Link>
          </div>
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <Link
              href="/dashboard/namespaces"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC] hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-colors"
            >
              @ Namespaces
            </Link>
            <Link
              href="/dashboard/tokens"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC] hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" /> API tokens
            </Link>
            <Link
              href="/dashboard/orgs"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC] hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-colors"
            >
              <Users className="w-3.5 h-3.5" /> Teams
            </Link>
            <Link
              href="/dashboard/security"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC] hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Security
            </Link>
            <Link
              href="/dashboard/analytics"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC] hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-colors"
            >
              <Activity className="w-3.5 h-3.5" /> Analytics
            </Link>
            {planInfo && (
              <Link
                href={
                  planInfo.plan === "free" ? "/pricing" : "/dashboard/billing"
                }
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border transition-colors ${
                  planInfo.plan === "free"
                    ? "border-[#7DD3FC]/20 text-[#7DD3FC] hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5"
                    : "border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#7DD3FC]"
                }`}
                title={
                  planInfo.cancelAt
                    ? `Cancels on ${planInfo.cancelAt.toISOString().slice(0, 10)}`
                    : `Status: ${planInfo.status}`
                }
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {planInfo.plan.toUpperCase()}
                {planInfo.plan === "free" ? " · Upgrade" : " · Manage"}
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="app-container app-shell py-12 grid grid-cols-1 xl:grid-cols-4 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <VerifyNudge trust={trust} />
          <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
            {"// Your Extensions"}
          </h3>

          {all.length === 0 ? (
            <div className="hud-card hud-corners p-12 text-center">
              <div className="p-3 rounded-full bg-[#7DD3FC]/5 border border-[#7DD3FC]/10 inline-flex mb-4">
                <Box className="w-5 h-5 text-[#7DD3FC]/30" />
              </div>
              <p className="text-sm font-mono text-[#f8fafc]/50 mb-1">
                No extensions yet.
              </p>
              <p className="text-xs font-mono text-[#f8fafc]/30 mb-6">
                Create your first one in under a minute.
              </p>
              <Link
                href="/new"
                className="inline-flex items-center gap-2 px-4 py-2 rounded text-[10px] font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
              >
                <Plus className="w-3 h-3" /> New Extension
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {all.map((ext) => {
                const priv = ext.visibility === "private";
                return (
                  <li key={ext.id}>
                    <Link
                      href={`/${ext.ownerHandle}/${ext.slug}`}
                      className="hud-card hud-corners p-5 flex items-center justify-between gap-4 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-mono font-bold text-[#7DD3FC] group-hover:text-[#BAE6FD]">
                            @{ext.ownerHandle}/{ext.slug}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              priv
                                ? "border border-[#f8fafc]/20 text-[#f8fafc]/50 bg-[#f8fafc]/5"
                                : "border border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
                            }`}
                          >
                            {priv ? (
                              <EyeOff className="w-2.5 h-2.5" />
                            ) : (
                              <Eye className="w-2.5 h-2.5" />
                            )}
                            {priv ? "Private" : "Public"}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-[#f8fafc]/40 truncate">
                          {ext.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] font-mono text-[#f8fafc]/30 flex-shrink-0">
                        <span className="flex items-center gap-1">
                          <Download className="w-3 h-3" /> {ext.downloads}
                        </span>
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3" /> {ext.stars}
                        </span>
                        <span className="text-[#7DD3FC]/50">
                          v{ext.latestVersion}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="space-y-6">
          {planInfo && <BandwidthCard userId={me.id} plan={planInfo.plan} />}
          <div className="hud-card hud-corners p-6 space-y-4">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Recent Activity"}
            </h4>
            <ul className="space-y-3 text-xs font-mono text-[#f8fafc]/50">
              {(all.length ? all.slice(0, 4) : []).map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <GitCommit className="w-3.5 h-3.5 text-[#7DD3FC]/50 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[#f8fafc]/70 truncate">
                      Released v{e.latestVersion}
                    </div>
                    <div className="text-[10px] text-[#f8fafc]/30 tracking-wider uppercase">
                      @{e.ownerHandle}/{e.slug}
                    </div>
                  </div>
                </li>
              ))}
              {all.length === 0 && (
                <li className="text-[#f8fafc]/30">No activity yet.</li>
              )}
            </ul>
          </div>

          {orgs.length > 0 && (
            <div className="hud-card hud-corners p-6 space-y-3">
              <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                {"// Organizations"}
              </h4>
              <ul className="space-y-2">
                {orgs.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <Link
                      href={`/${o.handle}`}
                      className="text-xs font-mono text-[#f8fafc]/60 hover:text-[#7DD3FC] truncate"
                    >
                      @{o.handle}
                    </Link>
                    <Link
                      href={`/org/${o.handle}/admin`}
                      className="text-[10px] tracking-[0.18em] uppercase text-[#7DD3FC]/70 hover:text-[#7DD3FC] shrink-0"
                    >
                      Admin →
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
