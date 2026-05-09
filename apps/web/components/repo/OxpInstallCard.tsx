"use client";

import { useState } from "react";
import { Check, Copy, Download, Terminal } from "lucide-react";

/**
 * OXP-native install card. Surfaces both supported install paths:
 *
 *   1. `oxp install @publisher/slug` — registry resolves the latest
 *      compatible semver, downloads the .oxp bundle, verifies the
 *      Ed25519 signature against the publisher's key, and stores the
 *      wasm in `$OXP_HOME/host-store/url-installs/<sha>/`. Hosts (VS
 *      Code, JetBrains, Neovim, Piye) pick it up automatically through
 *      their "From CLI…" picker.
 *
 *   2. `oxp install-url <bundle-url>` — bypass resolution and pin an
 *      exact version. Same end state in the host-store. Useful when
 *      reproducing a build, sharing a pre-release, or when the
 *      registry isn't reachable but a mirrored URL is.
 *
 * The bundle URL is also exposed as a plain download link so curl /
 * wget users can grab the artifact directly. Bundle endpoint is public
 * (no auth) and content-addressed, so leaking it costs nothing.
 */
export interface OxpInstallCardProps {
  scopedId: string;
  bundleUrl?: string;
  semver?: string;
}

export function OxpInstallCard({
  scopedId,
  bundleUrl,
  semver,
}: OxpInstallCardProps) {
  const installCmd = `oxp install ${scopedId}`;
  const installUrlCmd = bundleUrl ? `oxp install-url ${bundleUrl}` : null;

  return (
    <div className="hud-card hud-corners p-6">
      <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
        {"// Install"}
      </h3>

      <CopyRow
        label="Latest from registry"
        command={installCmd}
        accent="primary"
      />

      {installUrlCmd && bundleUrl && semver ? (
        <>
          <CopyRow
            label={`Pin v${semver} (direct bundle URL)`}
            command={installUrlCmd}
            accent="muted"
            className="mt-3"
          />
          <a
            href={bundleUrl}
            className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC] uppercase tracking-wider"
          >
            <Download className="w-3 h-3" />
            Download .oxp directly
          </a>
        </>
      ) : null}

      <p className="mt-4 text-xs font-mono text-[#f8fafc]/40 leading-relaxed">
        Native OXP extension — installs into the wasm-sandboxed runtime via the
        OXP CLI. Works across VS Code, JetBrains, Neovim, and Piye through the
        shared host-store.
      </p>
    </div>
  );
}

function CopyRow({
  label,
  command,
  accent,
  className,
}: {
  label: string;
  command: string;
  accent: "primary" | "muted";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }
  const promptColor =
    accent === "primary" ? "text-[#7DD3FC]/40" : "text-[#7DD3FC]/25";
  return (
    <div className={className}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#f8fafc]/30 mb-1.5">
        {label}
      </div>
      <button
        type="button"
        onClick={copy}
        title="Copy to clipboard"
        className="w-full bg-[#030711] rounded p-3 flex items-center justify-between gap-3 border border-[#7DD3FC]/8 hover:border-[#7DD3FC]/25 transition-colors text-left"
      >
        <div className="flex items-center gap-2 overflow-x-auto min-w-0">
          <Terminal className="w-4 h-4 text-[#7DD3FC]/40 flex-shrink-0" />
          <code className="text-xs font-mono text-[#f8fafc]/70 whitespace-nowrap overflow-x-auto">
            <span className={promptColor}>$</span> {command}
          </code>
        </div>
        <span className="text-[#f8fafc]/30 hover:text-[#7DD3FC] transition-colors flex-shrink-0">
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </span>
      </button>
    </div>
  );
}
