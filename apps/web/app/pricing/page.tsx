import Link from "next/link";
import { Check, Zap, Building2, Lock, ShieldCheck } from "lucide-react";
import { PLAN_ORDER, PLANS, type PlanId } from "@/lib/billing";

const ICONS: Record<PlanId, typeof Zap> = {
  free: Zap,
  pro: ShieldCheck,
  teams: Building2,
  enterprise: Building2,
};

interface MatrixRow {
  feature: string;
  free: string;
  pro: string;
  teams: string;
}

// The matrix is hand-curated rather than derived from PLANS so we can
// describe nuances ("Sigstore + customer KMS") that don't fit a boolean.
const matrix: MatrixRow[] = [
  {
    feature: "Public extensions",
    free: "Unlimited",
    pro: "Unlimited",
    teams: "Unlimited",
  },
  {
    feature: "Private extensions",
    free: "—",
    pro: "Unlimited",
    teams: "Unlimited",
  },
  {
    feature: "Private MCP servers",
    free: "—",
    pro: "5 (soon)",
    teams: "Unlimited (soon)",
  },
  {
    feature: "Organizations",
    free: "—",
    pro: "—",
    teams: "Unlimited",
  },
  {
    feature: "Seats included",
    free: "1",
    pro: "1",
    teams: "Per user",
  },
  {
    feature: "Personal namespaces",
    free: "3",
    pro: "Unlimited",
    teams: "Unlimited",
  },
  {
    feature: "CDN bandwidth",
    free: "10 GB",
    pro: "100 GB",
    teams: "1 TB",
  },
  {
    feature: "Signed releases",
    free: "—",
    pro: "Sigstore",
    teams: "Sigstore",
  },
  {
    feature: "Audit logs",
    free: "—",
    pro: "30 days (soon)",
    teams: "1 year (soon)",
  },
  {
    feature: "SSO (SAML / OIDC)",
    free: "—",
    pro: "—",
    teams: "Soon",
  },
  {
    feature: "Self-hosted registry",
    free: "—",
    pro: "—",
    teams: "—",
  },
  {
    feature: "Compliance",
    free: "—",
    pro: "—",
    teams: "GDPR DPA",
  },
  {
    feature: "Uptime SLA",
    free: "Best effort",
    pro: "99.5 %",
    teams: "99.9 %",
  },
  {
    feature: "Support",
    free: "Community",
    pro: "Email",
    teams: "Dedicated channel",
  },
];

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {/* ─── HERO ─── */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <Lock className="w-3.5 h-3.5 text-[#7DD3FC]/50" />
            <span className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Pricing"}
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-black text-[#f8fafc] mb-4">
            Built in the open.
            <br />
            <span className="text-[#7DD3FC]">Scales with your team.</span>
          </h1>
          <p className="text-base font-mono text-[#f8fafc]/50 max-w-2xl mx-auto">
            Every tier includes the full OXP runtime, CLI, and multi-host
            adapters. Start free, upgrade when you need privacy, governance, or
            self-hosting. Items without a tag ship today; items tagged{" "}
            <span className="text-[#7DD3FC]/80">soon</span> are on the active
            roadmap and land before your renewal.
          </p>
        </div>
      </section>

      {/* ─── TIER CARDS ─── */}
      <section className="mx-auto px-4 sm:px-6 lg:px-10 py-16 w-full max-w-370">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-7">
          {PLAN_ORDER.map((id) => {
            const tier = PLANS[id];
            const Icon = ICONS[id];
            return (
              <div
                key={tier.id}
                className={`relative ${tier.highlight ? "xl:-translate-y-3" : ""}`}
              >
                {tier.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none whitespace-nowrap">
                    <div className="relative inline-flex items-center gap-2 px-4 h-9 bg-[#7DD3FC] text-[#060a13] text-xs font-mono font-black tracking-[0.22em] uppercase shadow-[0_0_24px_-4px_rgba(125,211,252,0.7)]">
                      <span className="absolute inset-0 border border-[#BAE6FD]/60" />
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#060a13]" />
                      Most popular
                    </div>
                  </div>
                )}
                <div
                  className={`hud-card hud-corners h-full px-7 pt-9 pb-7 flex flex-col ${
                    tier.highlight
                      ? "border-[#7DD3FC]/40 bg-[#7DD3FC]/3 xl:shadow-[0_0_40px_-12px_rgba(125,211,252,0.25)]"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 text-[#7DD3FC]">
                      <Icon className="w-4 h-4" />
                    </div>
                    <h2 className="text-2xl font-black text-[#f8fafc]">
                      {tier.name}
                    </h2>
                  </div>
                  <p className="text-xs font-mono text-[#f8fafc]/45 mb-6 min-h-[4.5em] leading-relaxed">
                    {tier.tagline}
                  </p>
                  <div className="mb-8 min-h-21">
                    <div className="inline-flex items-baseline gap-1 leading-none">
                      {tier.priceCentsEur === null ? (
                        <span className="price-num text-5xl font-black leading-none">
                          Custom
                        </span>
                      ) : (
                        <>
                          <span className="price-currency text-2xl font-black leading-none translate-y-[-0.4em]">
                            €
                          </span>
                          <span className="price-num text-6xl font-black leading-none tracking-tight">
                            {Math.round(tier.priceCentsEur / 100)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="mt-2 text-xs font-mono font-bold tracking-[0.18em] text-[#7DD3FC]/60 uppercase price-cadence">
                      {tier.cadence}
                    </div>
                  </div>
                  <ul className="space-y-3 mb-8 flex-1">
                    {tier.features.map((f) => (
                      <li
                        key={f.label}
                        className="flex items-start gap-2.5 text-sm text-[#f8fafc]/70 leading-relaxed"
                      >
                        <Check className="w-4 h-4 text-[#7DD3FC] mt-0.5 shrink-0" />
                        <span>
                          {f.label}
                          {f.roadmap && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC]/60 bg-[#7DD3FC]/5 align-middle">
                              Soon
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {tier.ctaHref.startsWith("/api/") ? (
                    <a
                      href={tier.ctaHref}
                      className={`block text-center px-4 py-3 rounded text-sm font-mono font-bold tracking-wider uppercase transition-all ${
                        tier.highlight
                          ? "bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD]"
                          : "border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10"
                      }`}
                    >
                      {tier.cta}
                    </a>
                  ) : (
                    <Link
                      href={tier.ctaHref}
                      className={`block text-center px-4 py-3 rounded text-sm font-mono font-bold tracking-wider uppercase transition-all ${
                        tier.highlight
                          ? "bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD]"
                          : "border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10"
                      }`}
                    >
                      {tier.cta}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-center text-xs font-mono text-[#f8fafc]/40 tracking-wider uppercase mt-6">
          Prices in EUR · Billed via Paddle · VAT applied where required ·
          Cancel anytime
        </p>
      </section>

      {/* ─── COMPARE MATRIX ─── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 w-full">
        <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
          {"// Feature comparison"}
        </h2>
        <div className="hud-card hud-corners overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[#030711]/60 border-b border-[#7DD3FC]/10">
              <tr className="text-xs font-mono text-[#7DD3FC]/60 uppercase tracking-wider">
                <th className="text-left px-6 py-4">Feature</th>
                <th className="text-left px-6 py-4">Free</th>
                <th className="text-left px-6 py-4 bg-[#7DD3FC]/5 text-[#7DD3FC]">
                  Pro
                </th>
                <th className="text-left px-6 py-4">Teams</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr
                  key={row.feature}
                  className="border-b border-[#7DD3FC]/5 last:border-0"
                >
                  <td className="px-6 py-3 text-xs font-mono text-[#f8fafc]/70">
                    {row.feature}
                  </td>
                  <td className="px-6 py-3 text-xs font-mono text-[#f8fafc]/50">
                    {row.free}
                  </td>
                  <td className="px-6 py-3 text-xs font-mono text-[#7DD3FC]/80 bg-[#7DD3FC]/3">
                    {row.pro}
                  </td>
                  <td className="px-6 py-3 text-xs font-mono text-[#f8fafc]/50">
                    {row.teams}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── FAQ STRIP ─── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 w-full">
        <div className="hud-card hud-corners p-10 text-center">
          <h3 className="text-2xl md:text-3xl font-black text-[#f8fafc] mb-3">
            Start free. Cancel anytime.
          </h3>
          <p className="text-sm font-mono text-[#f8fafc]/40 mb-6 max-w-xl mx-auto">
            No annual lock-in, no sales calls. Upgrade when you need private
            extensions or organizations.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-5 py-3 rounded border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10 text-sm font-mono font-bold tracking-wider uppercase transition-all"
          >
            Get started
          </Link>
        </div>
      </section>
    </div>
  );
}
