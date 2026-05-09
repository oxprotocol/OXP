import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Package,
  Shield,
  ShieldCheck,
} from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  return { title: `@${handle}/${slug} · Versions` };
}
import {
  getExtension,
  getVersionsForExtension,
  extensions,
  users,
} from "@/lib/registry";
import { getExtensionDb, getVersionsForExtensionDb } from "@/lib/registry-db";
import { parseVsxMeta } from "@/lib/vsx-meta";
import { fetchOpenVsxLive } from "@/lib/openvsx";

export function generateStaticParams() {
  return extensions.map((e) => ({ handle: e.ownerHandle, slug: e.slug }));
}

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  // Seed first, then DB so newly-published extensions list their versions.
  let ext = getExtension(handle, slug);
  let all = ext ? getVersionsForExtension(ext.id) : [];
  if (!ext) {
    const dbExt = await getExtensionDb(handle, slug).catch(() => null);
    if (dbExt) {
      ext = dbExt;
      all = await getVersionsForExtensionDb(dbExt.id).catch(() => []);
    }
  }
  if (!ext) notFound();

  // Detect VSX-mirrored entries and pull live release info from Open VSX.
  const vsx = parseVsxMeta(ext.readme);
  const live = vsx ? await fetchOpenVsxLive(vsx.namespace, vsx.name) : null;
  const isVsx = !!vsx;
  const totalReleases = isVsx ? (live ? 1 : 0) : all.length;

  return (
    <div className="flex flex-col flex-1 w-full relative" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-8">
          <div className="flex items-center gap-2 mb-6">
            <Link
              href={`/${ext.ownerHandle}/${ext.slug}`}
              className="flex items-center gap-2 text-[10px] font-mono text-[#f8fafc]/30 hover:text-[#7DD3FC] transition-colors tracking-wider uppercase"
            >
              <ArrowLeft className="w-3 h-3" />
              {ext.title}
            </Link>
            <ChevronRight className="w-3 h-3 text-[#f8fafc]/15" />
            <span className="text-[10px] font-mono text-[#f8fafc]/50 tracking-wider uppercase">
              Versions
            </span>
          </div>

          <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc] mb-2">
            Version history
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40">
            <span className="text-[#7DD3FC]/70">
              @{ext.ownerHandle}/{ext.slug}
            </span>
            <span className="mx-2 text-[#f8fafc]/15">·</span>
            {totalReleases} {totalReleases === 1 ? "release" : "releases"}
            {isVsx ? (
              <>
                <span className="mx-2 text-[#f8fafc]/15">·</span>
                <span className="text-emerald-300">via Open VSX</span>
              </>
            ) : null}
          </p>
        </div>
      </section>

      <section className="app-container app-shell py-12">
        {isVsx ? (
          <VsxVersionsCard ext={ext} vsx={vsx!} live={live} />
        ) : (
          <div className="hud-card hud-corners overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#030711]/60 border-b border-[#7DD3FC]/10">
                <tr className="text-[10px] font-mono text-[#7DD3FC]/50 uppercase tracking-wider">
                  <th className="text-left px-6 py-3">Version</th>
                  <th className="text-left px-6 py-3">Published</th>
                  <th className="text-left px-6 py-3">Size</th>
                  <th className="text-left px-6 py-3">Signed by</th>
                  <th className="text-left px-6 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {all.map((v, idx) => {
                  const signer = users.find((u) => u.id === v.signedByUserId);
                  const isLatest = idx === 0;
                  return (
                    <tr
                      key={v.id}
                      className="border-b border-[#7DD3FC]/5 last:border-0 hover:bg-[#7DD3FC]/2 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-[#7DD3FC]/40" />
                          <span className="font-mono font-bold text-[#f8fafc]/80">
                            v{v.semver}
                          </span>
                          {isLatest && (
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-400 bg-emerald-500/5 uppercase tracking-wider">
                              Latest
                            </span>
                          )}
                          {v.yankedAt && (
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-red-500/30 text-red-400 bg-red-500/5 uppercase tracking-wider">
                              Yanked
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-[#f8fafc]/50">
                        {v.publishedAt}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-[#f8fafc]/50">
                        {v.bundleSize}
                      </td>
                      <td className="px-6 py-4">
                        {signer ? (
                          <Link
                            href={`/${signer.handle}`}
                            className="inline-flex items-center gap-1.5 text-xs font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC]"
                          >
                            <Shield className="w-3 h-3" />@{signer.handle}
                          </Link>
                        ) : (
                          <span className="text-xs font-mono text-[#f8fafc]/30">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-[#f8fafc]/55 max-w-md">
                        {v.changelog}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function VsxVersionsCard({
  ext,
  vsx,
  live,
}: {
  ext: { ownerHandle: string; slug: string; latestVersion: string | null };
  vsx: { namespace: string; name: string; version: string };
  live: Awaited<ReturnType<typeof fetchOpenVsxLive>>;
}) {
  const version = live?.version ?? vsx.version ?? ext.latestVersion ?? "";
  const published = live?.timestamp
    ? new Date(live.timestamp).toISOString().slice(0, 10)
    : "—";
  const vsixUrl = live?.files?.download;
  const sha = live?.files?.sha256;
  return (
    <div className="space-y-4">
      <div className="hud-card hud-corners p-6 border-emerald-400/15">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-emerald-300 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-mono font-bold tracking-wider uppercase text-emerald-300 mb-1">
              Hosted by Open VSX
            </p>
            <p className="text-xs font-mono text-[#f8fafc]/60 leading-relaxed">
              VSX-mirrored extensions don’t maintain a release history inside
              OXP — they ship from the upstream Open VSX registry. The latest
              release below is fetched live (refreshed hourly).
            </p>
          </div>
        </div>
      </div>

      <div className="hud-card hud-corners overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#030711]/60 border-b border-[#7DD3FC]/10">
            <tr className="text-xs font-mono text-[#7DD3FC]/50 uppercase tracking-wider">
              <th className="text-left px-6 py-3">Version</th>
              <th className="text-left px-6 py-3">Published</th>
              <th className="text-left px-6 py-3">Source</th>
              <th className="text-left px-6 py-3">SHA-256</th>
              <th className="text-left px-6 py-3">Download</th>
            </tr>
          </thead>
          <tbody>
            <tr className="hover:bg-[#7DD3FC]/2 transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <Package className="w-3.5 h-3.5 text-[#7DD3FC]/40" />
                  <span className="font-mono font-bold text-[#f8fafc]/80">
                    v{version}
                  </span>
                  <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-400 bg-emerald-500/5 uppercase tracking-wider">
                    Latest
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 font-mono text-xs text-[#f8fafc]/50">
                {published}
              </td>
              <td className="px-6 py-4">
                <a
                  href={`https://open-vsx.org/extension/${vsx.namespace}/${vsx.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-300 hover:text-emerald-200"
                >
                  <Shield className="w-3 h-3" /> open-vsx.org
                </a>
              </td>
              <td className="px-6 py-4 font-mono text-xs text-[#f8fafc]/40">
                {sha ? (
                  <a
                    href={sha}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#7DD3FC] inline-flex items-center gap-1"
                  >
                    .sha256 <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-[#f8fafc]/30">—</span>
                )}
              </td>
              <td className="px-6 py-4">
                {vsixUrl ? (
                  <a
                    href={vsixUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[#7DD3FC] hover:text-[#BAE6FD]"
                  >
                    <Download className="w-3 h-3" /> .vsix
                  </a>
                ) : (
                  <span className="text-xs font-mono text-[#f8fafc]/30">—</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
