import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  return { title: `@${handle}/${slug}` };
}

import {
  Calendar,
  Download,
  ExternalLink,
  GitCommit,
  Globe,
  Monitor,
  Scale,
  Shield,
  ShieldCheck,
  Star,
  Tag,
} from "lucide-react";
import { getExtension, getLatestVersion } from "@/lib/registry";
import { getExtensionDb, getVersionsForExtensionDb } from "@/lib/registry-db";
import { getPublisherTrust } from "@/lib/publisher-level";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { prisma } from "@/lib/prisma";
import { StatusBadges } from "@/components/ui/Badge";
import { MarkdownReadme } from "@/components/ui/MarkdownReadme";
import { parseVsxMeta } from "@/lib/vsx-meta";
import { fetchOpenVsxLive, fetchOpenVsxReadme } from "@/lib/openvsx";
import { OxpInstallCard } from "@/components/repo/OxpInstallCard";
import { VsxInstallCard } from "@/components/repo/VsxInstallCard";

export default async function RepoOverviewPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  let ext = getExtension(handle, slug);
  let latest = ext ? getLatestVersion(ext.id) : undefined;
  if (!ext) {
    const dbExt = await getExtensionDb(handle, slug).catch(() => null);
    if (dbExt) {
      ext = dbExt;
      const versions = await getVersionsForExtensionDb(dbExt.id).catch(
        () => [],
      );
      latest = versions[0];
    }
  }
  if (!ext) notFound();
  const scopedId = `@${ext.ownerHandle}/${ext.slug}`;
  const vsx = parseVsxMeta(ext.readme);
  const appBaseUrl = (
    process.env.NEXT_PUBLIC_APP_URL || "https://oxp.sh"
  ).replace(/\/$/, "");
  const bundleUrl = latest?.semver
    ? `${appBaseUrl}/api/v1/extensions/${ext.ownerHandle}/${ext.slug}/versions/${latest.semver}/bundle`
    : undefined;

  // A listing is claimable when its owner User is a synthetic VSX placeholder.
  // The importer sets passwordHash to a `vsx-claimable:<uuid>:<uuid>` sentinel
  // that no bcrypt check can ever match, so the namespace is reserved but
  // unowned until a real publisher proves they control it.
  let claimable = false;
  if (vsx) {
    const owner = await prisma.user
      .findUnique({
        where: { handle: ext.ownerHandle },
        select: { passwordHash: true },
      })
      .catch(() => null);
    claimable = !!owner?.passwordHash?.startsWith("vsx-claimable:");
  }

  // Pull live trust signals from Open VSX in parallel — cached 1h via Next.
  const live = vsx ? await fetchOpenVsxLive(vsx.namespace, vsx.name) : null;
  const liveReadme = live?.files?.readme
    ? await fetchOpenVsxReadme(live.files.readme)
    : null;

  // Phase B.8 — publisher trust tier (denormalized + bulk-cheap).
  const trust = await getPublisherTrust(ext.ownerHandle).catch(() => null);

  // Phase B.4 / B.5 / B.5b — pull provenance + attestation + Sigstore for the latest version.
  const latestRow = await prisma.version
    .findFirst({
      where: { extensionId: ext.id },
      orderBy: { publishedAt: "desc" },
      select: {
        semver: true,
        provenanceJson: true,
        attestationJson: true,
        signatureAlgo: true,
        rekorLogIndex: true,
        signerIdentity: true,
        signerIssuer: true,
      },
    })
    .catch(() => null);
  const provenance = (latestRow?.provenanceJson ?? null) as {
    commit?: string;
    buildCommand?: string;
    builder?: string;
    sourceUrl?: string;
  } | null;
  const hasAttestation = !!latestRow?.attestationJson;
  const sigstore = latestRow?.rekorLogIndex
    ? {
        logIndex: latestRow.rekorLogIndex,
        identity: latestRow.signerIdentity ?? "",
        issuer: latestRow.signerIssuer ?? "",
      }
    : null;

  return (
    <section className="app-container app-shell py-12">
      {/* Status badges row — VSX Compatible / OXP Native: Planned / etc. */}
      <StatusBadges tags={ext.tags} className="mb-6" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="hud-card hud-corners p-8">
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
              {"// Description"}
            </h2>
            <p className="text-[#f8fafc]/60 font-mono text-sm leading-relaxed">
              {ext.description}
            </p>
          </div>

          <div className="hud-card hud-corners p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                {"// Readme"}
              </h2>
              {vsx ? (
                <a
                  href={`https://open-vsx.org/extension/${vsx.namespace}/${vsx.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC] uppercase tracking-wider inline-flex items-center gap-1"
                >
                  Open VSX <ExternalLink className="w-3 h-3" />
                </a>
              ) : null}
            </div>
            {liveReadme ? (
              <MarkdownReadme source={liveReadme} />
            ) : vsx ? (
              <div className="border border-dashed border-[#7DD3FC]/10 rounded p-8 text-center">
                <p className="text-[#f8fafc]/40 font-mono text-xs mb-3">
                  Readme is hosted on Open VSX.
                </p>
                <a
                  href={`https://open-vsx.org/extension/${vsx.namespace}/${vsx.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/5 text-[#7DD3FC] hover:bg-[#7DD3FC]/10 transition text-xs font-mono font-bold tracking-wider uppercase"
                >
                  View on Open VSX <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : (
              <div className="border border-dashed border-[#7DD3FC]/10 rounded p-12 text-center">
                <div className="p-3 rounded-full bg-[#7DD3FC]/5 border border-[#7DD3FC]/10 inline-flex mb-4">
                  <ExternalLink className="w-5 h-5 text-[#7DD3FC]/30" />
                </div>
                <p className="text-[#f8fafc]/25 font-mono text-sm mb-1">
                  Readme rendered from{" "}
                  <Link
                    href={`/${ext.ownerHandle}/${ext.slug}/files/README.md`}
                    className="text-[#7DD3FC]/60 hover:text-[#7DD3FC] underline-offset-2 hover:underline"
                  >
                    README.md
                  </Link>
                </p>
                <p className="text-[#f8fafc]/15 font-mono text-xs">
                  Open the Files tab to browse the repository
                </p>
              </div>
            )}
          </div>

          {latest && (
            <div className="hud-card hud-corners p-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                  {"// Latest Release"}
                </h2>
                <Link
                  href={`/${ext.ownerHandle}/${ext.slug}/versions`}
                  className="text-[10px] font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC] uppercase tracking-wider"
                >
                  All versions →
                </Link>
              </div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-lg font-mono font-bold text-[#7DD3FC]">
                  v{latest.semver}
                </span>
                <span className="text-[10px] font-mono text-[#f8fafc]/30">
                  {latest.publishedAt} · {latest.bundleSize}
                </span>
              </div>
              <p className="text-sm text-[#f8fafc]/60 font-mono">
                {latest.changelog}
              </p>
              {sigstore && (
                <div className="mt-5 pt-5 border-t border-[#7DD3FC]/10">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-emerald-300/80 uppercase">
                      Sigstore signed
                    </span>
                  </div>
                  <dl className="text-xs font-mono space-y-1 text-[#f8fafc]/60">
                    <div className="flex justify-between gap-3">
                      <dt className="text-[#f8fafc]/40">Identity</dt>
                      <dd className="truncate max-w-[280px]">
                        {sigstore.identity || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[#f8fafc]/40">Issuer</dt>
                      <dd className="truncate max-w-[280px]">
                        {issuerLabel(sigstore.issuer)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[#f8fafc]/40">Rekor</dt>
                      <dd>
                        <a
                          href={`https://search.sigstore.dev/?logIndex=${encodeURIComponent(sigstore.logIndex)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#7DD3FC] hover:underline inline-flex items-center gap-1"
                        >
                          #{sigstore.logIndex}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {vsx ? (
            <VsxInstallCard
              namespace={vsx.namespace}
              name={vsx.name}
              worksIn={vsx.worksIn}
            />
          ) : (
            <OxpInstallCard
              scopedId={scopedId}
              bundleUrl={bundleUrl}
              semver={latest?.semver}
            />
          )}

          {vsx && live ? (
            <div className="hud-card hud-corners p-6">
              <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4 flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" />
                {"// Source signals"}
              </h3>
              <dl className="space-y-3 text-xs font-mono">
                {live.verified ? (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      Publisher
                    </dt>
                    <dd className="text-emerald-300">Verified ✓</dd>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-[#f8fafc]/30" />
                      Publisher
                    </dt>
                    <dd className="text-[#f8fafc]/40">Unverified</dd>
                  </div>
                )}
                {typeof live.averageRating === "number" ? (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <Star className="w-3 h-3 text-[#7DD3FC]/40" />
                      Rating
                    </dt>
                    <dd className="text-[#f8fafc]/80">
                      {live.averageRating.toFixed(1)}
                      <span className="text-[#f8fafc]/30">
                        {" "}
                        ({live.reviewCount ?? 0})
                      </span>
                    </dd>
                  </div>
                ) : null}
                {typeof live.downloadCount === "number" ? (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <Download className="w-3 h-3 text-[#7DD3FC]/40" />
                      Downloads
                    </dt>
                    <dd className="text-[#f8fafc]/80">
                      {formatNumber(live.downloadCount)}
                    </dd>
                  </div>
                ) : null}
                {live.timestamp ? (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3 text-[#7DD3FC]/40" />
                      Published
                    </dt>
                    <dd className="text-[#f8fafc]/80">
                      {new Date(live.timestamp).toISOString().slice(0, 10)}
                    </dd>
                  </div>
                ) : null}
                {live.license ? (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <Scale className="w-3 h-3 text-[#7DD3FC]/40" />
                      License
                    </dt>
                    <dd className="text-[#f8fafc]/80">{live.license}</dd>
                  </div>
                ) : null}
                {live.repository ? (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <GitCommit className="w-3 h-3 text-[#7DD3FC]/40" />
                      Source
                    </dt>
                    <dd className="text-[#f8fafc]/80 truncate max-w-[140px]">
                      <a
                        href={live.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#7DD3FC] inline-flex items-center gap-1"
                      >
                        repo <ExternalLink className="w-3 h-3" />
                      </a>
                    </dd>
                  </div>
                ) : null}
                {live.homepage ? (
                  <div className="flex items-center justify-between text-[#f8fafc]/60">
                    <dt className="flex items-center gap-1.5">
                      <Globe className="w-3 h-3 text-[#7DD3FC]/40" />
                      Homepage
                    </dt>
                    <dd className="text-[#f8fafc]/80 truncate max-w-[140px]">
                      <a
                        href={live.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#7DD3FC] inline-flex items-center gap-1"
                      >
                        link <ExternalLink className="w-3 h-3" />
                      </a>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-4 pt-3 border-t border-[#7DD3FC]/10 text-xs font-mono text-[#f8fafc]/30 leading-relaxed">
                Live from{" "}
                <a
                  href={`https://open-vsx.org/extension/${vsx.namespace}/${vsx.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#7DD3FC]/60 hover:text-[#7DD3FC]"
                >
                  open-vsx.org
                </a>
                . Refreshed hourly.
              </p>
            </div>
          ) : null}

          {claimable ? (
            <div className="hud-card hud-corners p-6 border-sky-400/20">
              <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-sky-300 uppercase mb-3">
                {"// Are you the author?"}
              </h3>
              <p className="text-xs font-mono text-[#f8fafc]/50 leading-relaxed mb-4">
                This listing is mirrored from Open VSX. Claim it to ship a
                native OXP build, customise the page, and respond to reviews.
              </p>
              <Link
                href={`/dashboard/claim/${encodeURIComponent(scopedId)}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20 transition text-xs font-mono font-bold tracking-wider uppercase"
              >
                Claim this listing
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          ) : null}

          <div className="hud-card hud-corners p-6">
            <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
              {"// Package Info"}
            </h3>
            <dl className="space-y-4">
              <Row icon={<Calendar className="w-3 h-3" />} label="Version">
                {ext.latestVersion}
              </Row>
              <Divider />
              <Row icon={<Shield className="w-3 h-3" />} label="Owner" accent>
                <span className="inline-flex items-center gap-1.5">
                  @{ext.ownerHandle}
                  <VerifiedBadge
                    level={trust?.level}
                    domain={trust?.domain}
                    githubLogin={trust?.githubLogin}
                    size="sm"
                  />
                </span>
              </Row>
              <Divider />
              <Row icon={<Download className="w-3 h-3" />} label="Downloads">
                {ext.downloads}
              </Row>
              <Divider />
              <Row icon={<Star className="w-3 h-3" />} label="Stars">
                {ext.stars.toLocaleString()}
              </Row>
            </dl>
          </div>

          {provenance || hasAttestation ? (
            <div className="hud-card hud-corners p-6">
              <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4 flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" />
                {"// Provenance"}
              </h3>
              <dl className="space-y-3 text-xs font-mono">
                {provenance?.commit ? (
                  <div className="flex items-start gap-2">
                    <GitCommit className="w-3 h-3 mt-0.5 text-[#7DD3FC]/40 flex-shrink-0" />
                    <div className="min-w-0">
                      <dt className="text-[#f8fafc]/40">commit</dt>
                      <dd className="text-[#f8fafc]/80 truncate">
                        {provenance.sourceUrl ? (
                          <a
                            href={provenance.sourceUrl}
                            className="hover:text-[#7DD3FC] transition-colors"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {provenance.commit.slice(0, 12)}
                            <ExternalLink className="w-3 h-3 inline ml-1" />
                          </a>
                        ) : (
                          provenance.commit.slice(0, 12)
                        )}
                      </dd>
                    </div>
                  </div>
                ) : null}
                {provenance?.builder ? (
                  <div>
                    <dt className="text-[#f8fafc]/40">builder</dt>
                    <dd className="text-[#f8fafc]/80">{provenance.builder}</dd>
                  </div>
                ) : null}
                {provenance?.buildCommand ? (
                  <div>
                    <dt className="text-[#f8fafc]/40 mb-1">build</dt>
                    <dd className="bg-[#030711] rounded p-2 border border-[#7DD3FC]/8 text-[#f8fafc]/70 break-all">
                      {provenance.buildCommand}
                    </dd>
                  </div>
                ) : null}
                {hasAttestation ? (
                  <div className="pt-2 border-t border-[#7DD3FC]/10 flex items-center gap-2 text-[#7DD3FC]">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Signed attestation present</span>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}

          <div className="hud-card hud-corners p-6">
            <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4 flex items-center gap-2">
              <Tag className="w-3 h-3" />
              {"// Tags"}
            </h3>
            <div className="flex flex-wrap gap-2">
              {ext.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/packages?tag=${tag}`}
                  className="px-3 py-1 rounded text-[10px] font-mono border border-[#7DD3FC]/10 text-[#f8fafc]/30 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30 hover:bg-[#7DD3FC]/5 transition-all"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  icon,
  label,
  children,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs font-mono text-[#f8fafc]/25 flex items-center gap-2">
        {icon}
        {label}
      </dt>
      <dd
        className={`text-xs font-mono font-bold ${accent ? "text-[#7DD3FC]/70" : "text-[#f8fafc]/60"}`}
      >
        {children}
      </dd>
    </div>
  );
}

function Divider() {
  return <div className="h-[1px] bg-[#7DD3FC]/5" />;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function issuerLabel(issuer: string): string {
  if (!issuer) return "—";
  if (issuer.includes("accounts.google.com")) return "Google";
  if (issuer.includes("github")) return "GitHub Actions";
  if (issuer.includes("login.microsoft")) return "Microsoft";
  if (issuer.includes("oauth2.sigstore.dev")) return "Sigstore OAuth";
  try {
    return new URL(issuer).hostname;
  } catch {
    return issuer;
  }
}
