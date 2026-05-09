"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

/**
 * VSX install card — open the extension directly in the user's IDE via the
 * native `<scheme>:extension/<publisher>.<name>` deep link. No CLI, no proxy:
 * the IDE handles the install through its own marketplace registration.
 *
 * OXP-native extensions use a different card (the `oxp install` flow) since
 * they ship through our wasm runtime, not the IDE marketplace.
 */

interface IdeTarget {
  /** Display label */
  label: string;
  /** URL scheme registered by the IDE */
  scheme: string;
}

const IDE_TARGETS: Record<string, IdeTarget> = {
  vscode: { label: "VS Code", scheme: "vscode" },
  cursor: { label: "Cursor", scheme: "cursor" },
  windsurf: { label: "Windsurf", scheme: "windsurf" },
  vscodium: { label: "VSCodium", scheme: "vscodium" },
};

export interface VsxInstallCardProps {
  namespace: string;
  name: string;
  /** IDE families this extension supports — drives which buttons render. */
  worksIn?: string[];
}

export function VsxInstallCard({
  namespace,
  name,
  worksIn,
}: VsxInstallCardProps) {
  const extensionId = `${namespace.toLowerCase()}.${name}`;
  // Default to all four IDEs when the importer didn't supply a worksIn list.
  const ides = (
    worksIn && worksIn.length > 0 ? worksIn : Object.keys(IDE_TARGETS)
  )
    .map((raw) => {
      const key = raw.toLowerCase();
      const target = IDE_TARGETS[key];
      return target ? { key, ...target } : null;
    })
    .filter((t): t is { key: string } & IdeTarget => t !== null);

  const [copied, setCopied] = useState(false);
  async function copyId() {
    try {
      await navigator.clipboard.writeText(extensionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="hud-card hud-corners p-6">
      <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
        {"// Install"}
      </h3>

      <p className="text-xs font-mono text-[#f8fafc]/60 leading-relaxed mb-4">
        Open this extension directly in your IDE — no CLI, no extra tools.
      </p>

      <div className="flex flex-col gap-2 mb-4">
        {ides.map((ide) => (
          <a
            key={ide.key}
            href={`${ide.scheme}:extension/${extensionId}`}
            className="group flex items-center justify-between gap-3 rounded border border-[#7DD3FC]/15 bg-[#030711] px-3 py-2.5 hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-colors"
          >
            <span className="text-xs font-mono text-[#f8fafc]/80 group-hover:text-[#7DD3FC]">
              Open in {ide.label}
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-[#7DD3FC]/40 group-hover:text-[#7DD3FC]" />
          </a>
        ))}
      </div>

      <div className="rounded border border-[#7DD3FC]/8 bg-[#030711] p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-mono text-[#f8fafc]/30 uppercase tracking-wider">
            Extension ID
          </span>
          <button
            type="button"
            onClick={copyId}
            className="text-[#f8fafc]/30 hover:text-[#7DD3FC] transition-colors"
            aria-label="Copy extension ID"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <code className="text-xs font-mono text-[#f8fafc]/70 break-all">
          {extensionId}
        </code>
      </div>

      <p className="mt-3 text-xs font-mono text-[#f8fafc]/40 leading-relaxed">
        If your IDE doesn&apos;t open automatically, copy the ID above and paste
        it into the Extensions view (
        <code className="text-[#7DD3FC]/70">⌘P</code> →{" "}
        <code className="text-[#7DD3FC]/70">ext install &lt;id&gt;</code>).
      </p>
    </div>
  );
}
