import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Box,
  Building2,
  Download,
  Globe,
  MapPin,
  Star,
  User as UserIcon,
} from "lucide-react";
import {
  resolveHandle,
  getExtensionsByOwner,
  getSubscriptionFor,
  getMembersOfOrg,
  getOrgsForUser,
  namespaceHandles,
} from "@/lib/registry";
import { resolveHandleDb, getExtensionsByOwnerDb } from "@/lib/registry-db";
import { getPublisherTrust } from "@/lib/publisher-level";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Avatar } from "@/components/ui/Avatar";
import type { Plan } from "@/lib/types";

export function generateStaticParams() {
  return namespaceHandles
    .filter((n) => !n.reserved)
    .map((n) => ({ handle: n.handle }));
}

const planLabel: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  teams: "Teams",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return { title: `@${handle}` };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  // Seed first (covers demo data + reserved guard); fall back to DB so
  // freshly-signed-up users and freshly-published orgs get a real profile.
  let resolved = resolveHandle(handle);
  if (resolved.kind === "missing") {
    const db = await resolveHandleDb(handle).catch(() => null);
    if (db && db.kind !== "missing") resolved = db;
  }

  if (resolved.kind === "missing" || resolved.kind === "reserved") {
    notFound();
  }

  const isOrg = resolved.kind === "org";
  const subject =
    resolved.kind === "user"
      ? {
          displayName: resolved.user.displayName,
          bio: resolved.user.bio,
          website: resolved.user.website,
          location: resolved.user.location,
          avatarSeed: resolved.user.avatarSeed,
          avatarUrl: resolved.user.avatarUrl ?? null,
          avatarUpdatedAt: resolved.user.avatarUpdatedAt ?? null,
          joinedAt: resolved.user.joinedAt,
          verified: false,
          description: undefined as string | undefined,
        }
      : {
          displayName: resolved.org.displayName,
          bio: undefined,
          website: resolved.org.website,
          location: undefined,
          avatarSeed: resolved.org.handle.slice(0, 2).toUpperCase(),
          avatarUrl: null as string | null,
          avatarUpdatedAt: null as string | null,
          joinedAt: resolved.org.joinedAt,
          verified: resolved.org.verified,
          description: resolved.org.description,
        };

  const seedExts = getExtensionsByOwner(handle).filter(
    (e) => e.visibility === "public",
  );
  const dbExts = await getExtensionsByOwnerDb(handle).catch(() => []);
  const byKey = new Map<string, (typeof seedExts)[number]>();
  for (const e of seedExts) byKey.set(`${e.ownerHandle}/${e.slug}`, e);
  for (const e of dbExts)
    if (e.visibility === "public") byKey.set(`${e.ownerHandle}/${e.slug}`, e);
  const extensions = Array.from(byKey.values());
  const trust = await getPublisherTrust(handle).catch(() => null);
  const subjectArg =
    resolved.kind === "user"
      ? ({ kind: "user", user: resolved.user } as const)
      : ({ kind: "org", org: resolved.org } as const);
  const sub = getSubscriptionFor(subjectArg);
  const members =
    resolved.kind === "org" ? getMembersOfOrg(resolved.org.id) : [];
  const orgs = resolved.kind === "user" ? getOrgsForUser(resolved.user.id) : [];

  return (
    <div className="flex flex-col flex-1 w-full relative" style={{ zIndex: 2 }}>
      {/* ─── PROFILE HEADER ─── */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-10">
          <div className="flex items-center gap-2 mb-6">
            <Link
              href="/"
              className="text-[10px] font-mono text-[#f8fafc]/30 hover:text-[#7DD3FC] tracking-wider uppercase"
            >
              Registry
            </Link>
            <span className="text-[10px] text-[#f8fafc]/15">/</span>
            <span className="text-[10px] font-mono text-[#7DD3FC]/60 tracking-wider uppercase">
              @{handle}
            </span>
          </div>

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="flex items-start gap-5">
              <Avatar
                url={subject.avatarUrl}
                version={subject.avatarUpdatedAt}
                seed={subject.avatarSeed}
                size="w-20 h-20"
                textSize="text-2xl"
                alt={subject.displayName}
              />
              <div>
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc]">
                    {subject.displayName}
                  </h1>
                  <VerifiedBadge
                    level={trust?.level}
                    domain={trust?.domain}
                    githubLogin={trust?.githubLogin}
                    size="md"
                  />
                  {trust?.reserved &&
                    (!trust.level || trust.level === "unverified") && (
                      <span
                        title="Reserved brand handle — not yet claimed by the verified owner."
                        className="text-xs font-mono text-[#BAE6FD] bg-[#7DD3FC]/8 ring-1 ring-[#7DD3FC]/30 rounded px-2 py-0.5"
                      >
                        reserved
                      </span>
                    )}
                </div>
                <p className="text-sm font-mono text-[#f8fafc]/40 mb-3">
                  <span className="inline-flex items-center gap-1.5">
                    {isOrg ? (
                      <Building2 className="w-3.5 h-3.5" />
                    ) : (
                      <UserIcon className="w-3.5 h-3.5" />
                    )}
                    @{handle}
                  </span>
                  <span className="mx-2 text-[#f8fafc]/15">·</span>
                  joined {subject.joinedAt}
                </p>
                {(subject.bio || subject.description) && (
                  <p className="text-[#f8fafc]/60 max-w-2xl text-sm leading-relaxed">
                    {subject.bio ?? subject.description}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs font-mono text-[#f8fafc]/40">
                  {subject.location && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" />
                      {subject.location}
                    </span>
                  )}
                  {subject.website && (
                    <a
                      href={subject.website}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 hover:text-[#7DD3FC]"
                    >
                      <Globe className="w-3 h-3" />
                      {subject.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {sub && (
              <div className="text-right">
                <span className="text-[10px] font-mono text-[#f8fafc]/30 tracking-wider uppercase">
                  {"// Plan"}
                </span>
                <div className="mt-1 px-3 py-1.5 inline-flex items-center gap-2 rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 text-[#7DD3FC] text-xs font-mono font-bold">
                  {planLabel[sub.plan]}
                  {sub.plan === "teams" && (
                    <span className="text-[#7DD3FC]/50 font-normal">
                      · {sub.seats} seats
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─── BODY ─── */}
      <section className="app-container app-shell py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Extensions list */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-2">
              {"// Published Extensions"} ({extensions.length})
            </h2>
            {extensions.length === 0 ? (
              <div className="hud-card hud-corners p-12 text-center">
                <p className="text-[#f8fafc]/30 font-mono text-sm">
                  No public extensions yet.
                </p>
              </div>
            ) : (
              extensions.map((ext) => (
                <Link
                  key={ext.id}
                  href={`/${ext.ownerHandle}/${ext.slug}`}
                  className="block hud-card hud-corners p-5 hover:border-[#7DD3FC]/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 rounded border border-[#7DD3FC]/15 bg-[#7DD3FC]/5 text-[#7DD3FC]">
                        <Box className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-bold text-[#f8fafc] truncate">
                            {ext.title}
                          </h3>
                          <span className="text-[10px] font-mono text-[#f8fafc]/30">
                            v{ext.latestVersion}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-[#7DD3FC]/60 mb-2">
                          @{ext.ownerHandle}/{ext.slug}
                        </p>
                        <p className="text-sm text-[#f8fafc]/50 line-clamp-2">
                          {ext.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 text-[10px] font-mono text-[#f8fafc]/40 flex-shrink-0">
                      <span className="inline-flex items-center gap-1">
                        <Download className="w-3 h-3" />
                        {ext.downloads}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        {ext.stars.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {isOrg && (
              <div className="hud-card hud-corners p-6">
                <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
                  {"// Members"} ({members.length})
                </h3>
                <ul className="space-y-3">
                  {members.map((m) => (
                    <li key={m.user.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded border border-[#7DD3FC]/15 bg-[#7DD3FC]/5 text-[#7DD3FC] text-xs font-mono font-bold flex items-center justify-center">
                        {m.user.avatarSeed}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/${m.user.handle}`}
                          className="block text-xs text-[#f8fafc]/70 hover:text-[#7DD3FC] truncate"
                        >
                          {m.user.displayName}
                        </Link>
                        <p className="text-[10px] font-mono text-[#f8fafc]/30">
                          @{m.user.handle}
                        </p>
                      </div>
                      <span className="text-[10px] font-mono text-[#7DD3FC]/50 uppercase tracking-wider">
                        {m.role}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!isOrg && orgs.length > 0 && (
              <div className="hud-card hud-corners p-6">
                <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
                  {"// Organizations"}
                </h3>
                <ul className="space-y-3">
                  {orgs.map((o) => (
                    <li key={o.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded border border-[#7DD3FC]/15 bg-[#7DD3FC]/5 text-[#7DD3FC] text-xs font-mono font-bold flex items-center justify-center">
                        {o.handle.slice(0, 2).toUpperCase()}
                      </div>
                      <Link
                        href={`/${o.handle}`}
                        className="text-xs text-[#f8fafc]/70 hover:text-[#7DD3FC]"
                      >
                        @{o.handle}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="hud-card hud-corners p-6">
              <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
                {"// Stats"}
              </h3>
              <dl className="space-y-3 text-xs font-mono">
                <div className="flex justify-between">
                  <dt className="text-[#f8fafc]/30">Extensions</dt>
                  <dd className="text-[#f8fafc]/70 font-bold">
                    {extensions.length}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#f8fafc]/30">Total stars</dt>
                  <dd className="text-[#f8fafc]/70 font-bold">
                    {extensions
                      .reduce((acc, e) => acc + e.stars, 0)
                      .toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#f8fafc]/30">Account type</dt>
                  <dd className="text-[#7DD3FC]/70 font-bold uppercase">
                    {isOrg ? "Organization" : "User"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
