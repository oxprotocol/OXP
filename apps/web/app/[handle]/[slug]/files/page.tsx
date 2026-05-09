import { notFound } from "next/navigation";
import { Download, ExternalLink, Package, ShieldCheck } from "lucide-react";
import { CommitStrip } from "@/components/repo/CommitStrip";
import { DirListing } from "@/components/repo/FileTree";

export const dynamic = "force-dynamic";
import { getRepoTree, listRepoDirectory } from "@/lib/repos";
import { getExtensionDb } from "@/lib/registry-db";
import { parseVsxMeta } from "@/lib/vsx-meta";
import { fetchOpenVsxLive } from "@/lib/openvsx";

export default async function RepoFilesRootPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const tree = getRepoTree(handle, slug);
  if (!tree) {
    // Fall back: VSX-mirrored entries have no in-repo tree. Render an
    // explainer with the upstream .vsix download instead of 404'ing.
    const ext = await getExtensionDb(handle, slug);
    if (!ext) notFound();

    const vsx = ext ? parseVsxMeta(ext.readme) : null;
    if (vsx) {
      const live = await fetchOpenVsxLive(vsx.namespace, vsx.name);
      const vsixUrl = live?.files?.download ?? vsx.vsixUrl;
      const sha = live?.files?.sha256;

      return (
        <section className="app-container app-shell py-12">
          <div className="hud-card hud-corners p-8">
            <div className="flex items-start gap-3 mb-6">
              <ShieldCheck className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
              <div>
                <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-emerald-300 uppercase mb-2">
                  Source ships in the .vsix package
                </h2>
                <p className="text-xs font-mono text-[#f8fafc]/60 leading-relaxed">
                  This extension is mirrored from{" "}
                  <a
                    href={`https://open-vsx.org/extension/${vsx.namespace}/${vsx.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#7DD3FC] hover:text-[#BAE6FD] underline-offset-2 hover:underline"
                  >
                    open-vsx.org
                  </a>
                  . Source files live inside the signed .vsix package on the
                  upstream registry — OXP does not re-host them. Download the
                  package below to inspect or install it; it’s the same artifact
                  VS Code, Cursor, and VSCodium would fetch.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-6">
              <div className="rounded border border-[#7DD3FC]/15 bg-[#030711]/60 p-4">
                <p className="text-xs font-mono uppercase tracking-wider text-[#7DD3FC]/50 mb-2">
                  Package
                </p>
                <p className="text-xs font-mono text-[#f8fafc]/80">
                  {vsx.namespace}.{vsx.name}
                </p>
                <p className="text-xs font-mono text-[#f8fafc]/40 mt-1">
                  v{live?.version ?? vsx.version}
                </p>
              </div>
              <div className="rounded border border-[#7DD3FC]/15 bg-[#030711]/60 p-4">
                <p className="text-xs font-mono uppercase tracking-wider text-[#7DD3FC]/50 mb-2">
                  Integrity
                </p>
                {sha ? (
                  <a
                    href={sha}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#7DD3FC] hover:text-[#BAE6FD] inline-flex items-center gap-1"
                  >
                    SHA-256 manifest <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <p className="text-xs font-mono text-[#f8fafc]/40">
                    No checksum published
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {vsixUrl ? (
                <a
                  href={vsixUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#7DD3FC] hover:bg-[#7DD3FC]/15 transition text-xs font-mono font-bold tracking-wider uppercase"
                >
                  <Download className="w-3.5 h-3.5" /> Download .vsix
                </a>
              ) : null}
              <a
                href={`https://open-vsx.org/extension/${vsx.namespace}/${vsx.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#7DD3FC]/15 text-[#f8fafc]/70 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30 transition text-xs font-mono font-bold tracking-wider uppercase"
              >
                <Package className="w-3.5 h-3.5" /> Browse on Open VSX
              </a>
            </div>

            <p className="mt-6 pt-4 border-t border-[#7DD3FC]/10 text-xs font-mono text-[#f8fafc]/30 leading-relaxed">
              Want a fully signed, source-browsable extension? Build OXP-native
              — it ships with reproducible bundles, SLSA provenance, and
              per-file attestation rendered right here.
            </p>
          </div>
        </section>
      );
    }

    // OXP-native extension that hasn't published a browsable source tree
    // yet. The signed bundle is still downloadable from the registry; we
    // show a friendly explainer instead of a 404 so users know the
    // extension exists and how to inspect it.
    const bundleUrl = `/api/v1/extensions/${handle}/${slug}/versions/${ext.latestVersion}/bundle`;
    const repoUrl = ext.repositoryUrl;

    return (
      <section className="app-container app-shell py-12">
        <div className="hud-card hud-corners p-8">
          <div className="flex items-start gap-3 mb-6">
            <Package className="w-5 h-5 text-[#7DD3FC] mt-0.5 shrink-0" />
            <div>
              <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC] uppercase mb-2">
                Source ships in the .oxp bundle
              </h2>
              <p className="text-xs font-mono text-[#f8fafc]/60 leading-relaxed">
                This extension was published as a signed{" "}
                <code className="text-[#7DD3FC]">.oxp</code> bundle. Browsable
                source rendering isn’t wired up for native bundles yet — for
                now, download the bundle and inspect the wasm component
                directly, or visit the upstream repository if one is linked.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <div className="rounded border border-[#7DD3FC]/15 bg-[#030711]/60 p-4">
              <p className="text-xs font-mono uppercase tracking-wider text-[#7DD3FC]/50 mb-2">
                Package
              </p>
              <p className="text-xs font-mono text-[#f8fafc]/80">
                @{ext.ownerHandle}/{ext.slug}
              </p>
              <p className="text-xs font-mono text-[#f8fafc]/40 mt-1">
                v{ext.latestVersion}
              </p>
            </div>
            <div className="rounded border border-[#7DD3FC]/15 bg-[#030711]/60 p-4">
              <p className="text-xs font-mono uppercase tracking-wider text-[#7DD3FC]/50 mb-2">
                Repository
              </p>
              {repoUrl ? (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-[#7DD3FC] hover:text-[#BAE6FD] inline-flex items-center gap-1"
                >
                  {repoUrl.replace(/^https?:\/\//, "")}{" "}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <p className="text-xs font-mono text-[#f8fafc]/40">
                  None linked
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={bundleUrl}
              className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#7DD3FC] hover:bg-[#7DD3FC]/15 transition text-xs font-mono font-bold tracking-wider uppercase"
            >
              <Download className="w-3.5 h-3.5" /> Download .oxp
            </a>
            <a
              href={`/${handle}/${slug}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[#7DD3FC]/15 text-[#f8fafc]/70 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30 transition text-xs font-mono font-bold tracking-wider uppercase"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Back to overview
            </a>
          </div>

          <p className="mt-6 pt-4 border-t border-[#7DD3FC]/10 text-xs font-mono text-[#f8fafc]/30 leading-relaxed">
            Source-tree rendering for native bundles is on the roadmap — once
            shipped, every published <code>.oxp</code> will be browsable here
            with per-file SHA-256 attestation.
          </p>
        </div>
      </section>
    );
  }

  const entries = listRepoDirectory(handle, slug, "");

  return (
    <section className="app-container app-shell py-12">
      <CommitStrip tree={tree} />
      <DirListing
        ownerHandle={handle}
        slug={slug}
        parentPath=""
        entries={entries}
      />
    </section>
  );
}
