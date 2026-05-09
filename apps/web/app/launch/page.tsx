import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { packages } from "@/lib/packages";
import {
  Rocket,
  Activity,
  Download,
  Star,
  TrendingUp,
  Package as PackageIcon,
  Plus,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";

// Demo data — this page is a public preview of the signed-in dashboard.
// Real signed-in users are redirected to /dashboard below.
const myPackages = packages.slice(0, 3);

const activity = [
  {
    time: "2m ago",
    text: "jupyter-notebook-native@1.0.2 — 412 new installs",
    kind: "install",
  },
  {
    time: "1h ago",
    text: "claude-ai-assistant@2.1.0 — security scan passed",
    kind: "security",
  },
  {
    time: "4h ago",
    text: "tailwind-css-intellisense — issue #284 opened",
    kind: "issue",
  },
  {
    time: "1d ago",
    text: "jupyter-notebook-native@1.0.2 — release published",
    kind: "release",
  },
  { time: "2d ago", text: 'API token "ci-runner" rotated', kind: "security" },
];

export const metadata = {
  title: "Mission Control · Demo",
  description:
    "A preview of what your OXP dashboard looks like once you sign up.",
};

export default async function LaunchDashboard() {
  // Signed-in users get the real thing.
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const totalDownloads = "423k";
  const totalStars = myPackages
    .reduce((s, p) => s + p.stars, 0)
    .toLocaleString();

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {/* Demo banner */}
      <div className="border-b border-[#7DD3FC]/20 bg-[#7DD3FC]/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-mono text-[#7DD3FC]/80">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-bold tracking-wider uppercase">Demo</span>
            <span className="text-[#f8fafc]/50">
              You’re viewing a preview of Mission Control with sample data.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
            >
              Create free account
            </Link>
            <Link
              href="/signin"
              className="inline-flex items-center px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase text-[#f8fafc]/60 hover:text-[#7DD3FC] transition-all"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* Top bar */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Rocket className="w-4 h-4 text-[#7DD3FC]/40" />
                <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                  {"// Mission Control"}
                </h2>
              </div>
              <h1 className="text-2xl md:text-4xl font-black text-[#f8fafc]">
                Welcome back, <span className="text-[#7DD3FC]">@you</span>
              </h1>
              <p className="text-xs font-mono text-[#f8fafc]/40 mt-2">
                This is what your dashboard will look like.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#7DD3FC] text-[#060a13] font-mono font-bold text-xs tracking-wider uppercase rounded hover:bg-[#BAE6FD] transition-all"
              >
                <Plus className="w-4 h-4" />
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full space-y-8">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            icon={PackageIcon}
            label="Packages"
            value={myPackages.length.toString()}
          />
          <StatTile
            icon={Download}
            label="Downloads (30d)"
            value={totalDownloads}
          />
          <StatTile icon={Star} label="Total Stars" value={totalStars} />
          <StatTile icon={TrendingUp} label="Trend" value="+18.4%" accent />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* My packages */}
          <div className="lg:col-span-2 hud-card hud-corners p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                {"// My Packages"}
              </h3>
              <Link
                href="/packages"
                className="text-xs font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC] uppercase tracking-wider"
              >
                View all
              </Link>
            </div>
            <div className="divide-y divide-[#7DD3FC]/10">
              {myPackages.map((pkg) => (
                <Link
                  key={pkg.id}
                  href={`/packages/${pkg.id}`}
                  className="py-4 flex items-center gap-4 group"
                >
                  <div className="p-2 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5 text-[#7DD3FC]">
                    <PackageIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#f8fafc] group-hover:text-[#7DD3FC] transition-colors truncate">
                      {pkg.title}
                    </p>
                    <p className="text-xs font-mono text-[#f8fafc]/40 truncate">
                      v{pkg.version} · {pkg.publisher}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-xs font-mono text-[#f8fafc]/40">
                    <span className="flex items-center gap-1">
                      <Download className="w-3 h-3" />
                      {pkg.downloads}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-[#7DD3FC]/50" />
                      {pkg.stars}
                    </span>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-[#f8fafc]/20 group-hover:text-[#7DD3FC] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
                </Link>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div className="hud-card hud-corners p-6">
            <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-5 flex items-center gap-2">
              <Activity className="w-3 h-3" />
              {"// Live Activity"}
            </h3>
            <ul className="space-y-4">
              {activity.map((a, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${kindColor(a.kind)}`}
                  />
                  <div>
                    <p className="text-xs font-mono text-[#f8fafc]/60 leading-relaxed">
                      {a.text}
                    </p>
                    <p className="text-xs font-mono text-[#f8fafc]/25 mt-0.5">
                      {a.time}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickAction
            href="/publish"
            title="Publish a release"
            desc="Cut a new version of any package you maintain."
          />
          <QuickAction
            href="/docs/sdk"
            title="SDK reference"
            desc="Browse every universal hook the runtime exposes."
          />
          <QuickAction
            href="/community"
            title="Join the community"
            desc="Office hours, RFCs, and Discord — all in one place."
          />
        </div>
      </section>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="hud-card hud-corners p-5">
      <div className="flex items-center justify-between mb-3">
        <Icon className="w-4 h-4 text-[#7DD3FC]/40" />
        <span className="text-xs font-mono text-[#f8fafc]/30 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p
        className={`text-2xl md:text-3xl font-black font-mono ${accent ? "text-emerald-400" : "text-[#f8fafc]"}`}
      >
        {value}
      </p>
    </div>
  );
}

function QuickAction({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link href={href} className="hud-card hud-corners p-5 group block">
      <p className="text-sm font-bold text-[#f8fafc] mb-1 group-hover:text-[#7DD3FC] transition-colors">
        {title}
      </p>
      <p className="text-xs font-mono text-[#f8fafc]/40">{desc}</p>
    </Link>
  );
}

function kindColor(kind: string) {
  switch (kind) {
    case "install":
      return "bg-emerald-400";
    case "security":
      return "bg-[#7DD3FC]";
    case "issue":
      return "bg-red-400";
    default:
      return "bg-cyan-400";
  }
}
