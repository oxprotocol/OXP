/**
 * /vsx — VSX Mirror directory.
 *
 * Surfaces extensions imported from Open VSX (tag `vsx-compatible`) in
 * a clearly-labelled secondary registry. The split exists so the main
 * /packages directory stays focused on OXP-NATIVE packages — the format
 * we want developers to actually build for. Mirrored entries are useful
 * for IDE coverage today but they don't get the full OXP runtime
 * (capabilities, attestation, host portability), and we don't want
 * them drowning out native work in default rankings.
 */
import Link from "next/link";
import { ExternalLink, Package2 } from "lucide-react";
import { listPublishedPackages } from "@/lib/registry-db";
import { PackagesBrowseClient } from "../packages/PackagesBrowseClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "VSX Mirror" };

export default async function VsxBrowsePage() {
  let dbPackages: Awaited<ReturnType<typeof listPublishedPackages>> = [];
  try {
    dbPackages = await listPublishedPackages({
      requireTags: ["vsx-compatible"],
      limit: 200,
    });
  } catch (err) {
    console.error("[/vsx] DB query failed:", err);
  }

  return (
    <PackagesBrowseClient
      initialPackages={dbPackages}
      heading="VSX Mirror"
      eyebrow="// Open VSX Mirror"
      subtitle={`${dbPackages.length} extensions mirrored from open-vsx.org — installable through the OXP CLI on VS Code, Cursor, Windsurf, and VSCodium.`}
      searchPlaceholder="Filter VSX-mirrored extensions..."
      banner={
        <div className="mb-6 rounded border border-emerald-400/20 bg-emerald-400/5 p-5">
          <div className="flex items-start gap-3">
            <Package2 className="w-4 h-4 text-emerald-300 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-xs font-mono font-bold text-emerald-300 uppercase tracking-wider mb-1.5">
                  Mirrored from Open VSX — locked to the VS Code family
                </p>
                <p className="text-xs font-mono text-[#f8fafc]/65 leading-relaxed">
                  These extensions only run inside vscode-family editors (VS
                  Code, Cursor, Windsurf, VSCodium). They reach a fraction of
                  the developer market and depend on the upstream VS Code
                  extension API — not portable, not sandboxed, no provenance.
                </p>
              </div>

              <div className="rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 p-3">
                <p className="text-xs font-mono font-bold text-[#7DD3FC] uppercase tracking-wider mb-2">
                  Build OXP-native → ship to every IDE
                </p>
                <ul className="text-xs font-mono text-[#f8fafc]/70 leading-relaxed space-y-1.5">
                  <li className="flex gap-2">
                    <span className="text-[#7DD3FC]/60 flex-shrink-0">›</span>
                    <span>
                      <span className="text-[#f8fafc]/90 font-bold">
                        Universal host support:
                      </span>{" "}
                      one wasm bundle runs in JetBrains, Zed, Neovim, VS Code,
                      Cursor, Windsurf, web playgrounds — anywhere the OXP host
                      embeds.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#7DD3FC]/60 flex-shrink-0">›</span>
                    <span>
                      <span className="text-[#f8fafc]/90 font-bold">
                        Wider distribution:
                      </span>{" "}
                      published once to the OXP registry — discoverable across
                      every host, with versioned releases and search ranking you
                      actually own.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#7DD3FC]/60 flex-shrink-0">›</span>
                    <span>
                      <span className="text-[#f8fafc]/90 font-bold">
                        Real trust:
                      </span>{" "}
                      capability-scoped permissions, signed attestation,
                      reproducible bundles. Users see exactly what your
                      extension can do before they install.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#7DD3FC]/60 flex-shrink-0">›</span>
                    <span>
                      <span className="text-[#f8fafc]/90 font-bold">
                        Monetisable:
                      </span>{" "}
                      paid tiers, license keys, and seat management baked into
                      the registry — no Marketplace gatekeeper.
                    </span>
                  </li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href="/docs/introduction"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#7DD3FC] hover:bg-[#7DD3FC]/15 transition text-xs font-mono font-bold tracking-wider uppercase"
                  >
                    Build OXP-native
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                  <Link
                    href="/new"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#7DD3FC]/15 text-[#f8fafc]/70 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30 transition text-xs font-mono font-bold tracking-wider uppercase"
                  >
                    Start a project
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}
