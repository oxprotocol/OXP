import Link from "next/link";
import {
  Users,
  MessageSquare,
  Code2,
  Award,
  Star,
  GitBranch,
  ArrowRight,
  ExternalLink,
  CircleDot,
} from "lucide-react";
import { XTimeline } from "@/components/social/XTimeline";
import {
  getOrgStats,
  getTopContributors,
  getDiscordWidget,
  COMMUNITY_LINKS,
} from "@/lib/community";

export const metadata = { title: "Community" };
// Refresh server-side data every 30 minutes; lib helpers add their own
// `next: { revalidate }` per-fetch, but we set a page-level floor too.
export const revalidate = 1800;

const numberFmt = new Intl.NumberFormat("en-US");

export default async function CommunityPage() {
  const [orgStats, contributors, discord] = await Promise.all([
    getOrgStats(),
    getTopContributors(8, 5),
    getDiscordWidget(),
  ]);

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center gap-3 mb-3">
            <Users className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Community"}
            </h2>
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[#f8fafc] mb-2">
            Built in the open. Shipped together.
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40 max-w-2xl">
            One protocol, every editor, contributors from across the IDE
            ecosystem. Join the conversation, file an RFC, or ship the next host
            adapter.
          </p>

          {/* Live stat strip */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <LiveStat
              icon={Star}
              label="Total stars"
              value={orgStats ? numberFmt.format(orgStats.totalStars) : "—"}
              hint={
                orgStats
                  ? `${orgStats.totalRepos} public repos`
                  : "github offline"
              }
            />
            <LiveStat
              icon={Code2}
              label="Active repos"
              value={orgStats ? numberFmt.format(orgStats.totalRepos) : "—"}
              hint={orgStats ? `@${orgStats.org}` : "configure GITHUB_ORG"}
            />
            <LiveStat
              icon={MessageSquare}
              label="Discord online"
              value={discord ? numberFmt.format(discord.presenceCount) : "—"}
              hint={discord ? "live presence" : "widget disabled"}
            />
            <LiveStat
              icon={Users}
              label="Top contributors"
              value={contributors ? String(contributors.length) : "—"}
              hint="last 12 months"
            />
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full space-y-12">
        {/* ── Channels ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Channel
            icon={MessageSquare}
            title="Discord"
            desc={
              discord
                ? `${numberFmt.format(discord.presenceCount)} online · live voice rooms`
                : "Real-time chat, voice, support"
            }
            cta="Join the server"
            href={discord?.inviteUrl ?? COMMUNITY_LINKS.discord}
            external
          />
          <Channel
            icon={Code2}
            title="GitHub"
            desc={
              orgStats
                ? `${numberFmt.format(orgStats.totalRepos)} repos · ${numberFmt.format(orgStats.totalStars)} stars`
                : "Spec, runtime, CLI — all open source"
            }
            cta="View the org"
            href={COMMUNITY_LINKS.github}
            external
          />
          <Channel
            icon={Award}
            title="RFC Process"
            desc="Propose changes to the protocol"
            cta="Read the RFCs"
            href={COMMUNITY_LINKS.rfcs}
          />
        </div>

        {/* ── Repos + X feed ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top repos */}
          <div className="hud-card hud-corners p-6">
            <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase mb-5 flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5" />
              {"// Top repositories"}
            </h3>
            {!orgStats || orgStats.topRepos.length === 0 ? (
              <p className="text-sm font-mono text-[#f8fafc]/40">
                GitHub data unavailable. Browse{" "}
                <a
                  href={COMMUNITY_LINKS.github}
                  className="text-[#7DD3FC] hover:underline"
                >
                  the org directly →
                </a>
              </p>
            ) : (
              <ul className="divide-y divide-[#7DD3FC]/10">
                {orgStats.topRepos.map((r) => (
                  <li key={r.fullName}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="py-3 flex items-center justify-between gap-4 group"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#f8fafc] group-hover:text-[#7DD3FC] truncate">
                          {r.name}
                        </p>
                        <p className="text-xs font-mono text-[#f8fafc]/40 truncate">
                          {r.description ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {r.language && (
                          <span className="text-xs font-mono text-[#7DD3FC]/50">
                            {r.language}
                          </span>
                        )}
                        <span className="text-xs font-mono text-[#7DD3FC]/70 inline-flex items-center gap-1">
                          <Star className="w-3 h-3" />
                          {numberFmt.format(r.stars)}
                        </span>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* X timeline */}
          <div className="hud-card hud-corners p-6">
            <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase mb-5 flex items-center gap-2">
              <XMark className="w-3.5 h-3.5" />
              {`// @${COMMUNITY_LINKS.twitterHandle} on X`}
            </h3>
            <XTimeline handle={COMMUNITY_LINKS.twitterHandle} height={460} />
          </div>
        </div>

        {/* ── Top contributors ───────────────────────────────────────── */}
        <div className="hud-card hud-corners p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase">
              {"// Top contributors"}
            </h3>
            <a
              href={COMMUNITY_LINKS.github}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC] inline-flex items-center gap-1.5"
            >
              View on GitHub <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {!contributors || contributors.length === 0 ? (
            <p className="text-sm font-mono text-[#f8fafc]/40">
              Contributor data is loading or unavailable. Check back shortly.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {contributors.map((c) => (
                <a
                  key={c.login}
                  href={c.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="border border-[#7DD3FC]/10 rounded p-3 text-center hover:border-[#7DD3FC]/30 hover:bg-[#7DD3FC]/5 transition-colors block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.avatarUrl}
                    alt={`${c.login} avatar`}
                    width={40}
                    height={40}
                    loading="lazy"
                    className="w-10 h-10 mx-auto mb-2 rounded-full border border-[#7DD3FC]/20 bg-[#7DD3FC]/10"
                  />
                  <p className="text-xs font-mono text-[#f8fafc]/80 truncate">
                    {c.login}
                  </p>
                  <p className="text-xs font-mono text-[#7DD3FC]/60">
                    {numberFmt.format(c.contributions)} commits
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ── Discussions CTA (replaces showcase) ────────────────────── */}
        <div className="hud-card hud-corners p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 text-[#7DD3FC] mb-4">
            <CircleDot className="w-5 h-5" />
          </div>
          <h3 className="text-2xl font-black text-[#f8fafc] mb-3">
            Have something to share?
          </h3>
          <p className="text-sm font-mono text-[#f8fafc]/50 mb-6 max-w-xl mx-auto">
            Show off your extension, ask a question, or kick off an RFC on
            Discord — every conversation about OXP happens in the open.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={discord?.inviteUrl ?? COMMUNITY_LINKS.discord}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#7DD3FC] text-[#060a13] font-mono font-bold text-sm tracking-wider uppercase rounded hover:bg-[#BAE6FD] transition-all"
            >
              Join the Discord
              <ArrowRight className="w-4 h-4" />
            </a>
            <Link
              href="/publish"
              className="inline-flex items-center gap-2 px-6 py-3 border border-[#7DD3FC]/30 text-[#7DD3FC] font-mono font-bold text-sm tracking-wider uppercase rounded hover:border-[#7DD3FC]/60 hover:bg-[#7DD3FC]/5 transition-all"
            >
              Publish your extension
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── helpers ────────────────────────────────────────────────────────── */

// Lucide dropped brand glyphs in v0.418+, so we inline the X (Twitter) mark.
function XMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

function LiveStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="hud-card hud-corners p-4">
      <div className="flex items-center gap-2 mb-2 text-[#7DD3FC]/60">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs font-mono tracking-[0.18em] uppercase">
          {label}
        </span>
      </div>
      <p className="text-2xl font-black text-[#f8fafc] tabular-nums">{value}</p>
      <p className="text-xs font-mono text-[#f8fafc]/35 mt-1">{hint}</p>
    </div>
  );
}

function Channel({
  icon: Icon,
  title,
  desc,
  cta,
  href,
  external,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  cta: string;
  href: string;
  external?: boolean;
}) {
  const cls = "hud-card hud-corners p-6 group block";
  const inner = (
    <>
      <div className="p-2 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5 text-[#7DD3FC] inline-flex mb-4">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-base font-bold text-[#f8fafc] mb-2 group-hover:text-[#7DD3FC] transition-colors">
        {title}
      </h3>
      <p className="text-xs font-mono text-[#f8fafc]/45 mb-4">{desc}</p>
      <span className="inline-flex items-center gap-2 text-xs font-mono font-bold text-[#7DD3FC] uppercase tracking-wider">
        {cta}
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
      </span>
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}
