/**
 * VSX install adapter — handles `oxp install @publisher/slug` for entries
 * that are mirrored from Open VSX rather than published natively to OXP.
 *
 * Strategy:
 *   1. Caller pre-fetched `/api/v1/extensions/<publisher>/<slug>` and
 *      saw a `vsx` block in the response → call `installVsx()`.
 *   2. We detect the user's VS Code-family IDEs (already done by the
 *      install command) and run `<cli> --install-extension <ns>.<name>`
 *      against each one. The IDE's own install path handles VSIX fetch,
 *      signature checks (or lack thereof), and registration.
 *   3. We DO NOT touch the OXP shared host-store — VSX extensions are
 *      not OXP wasm components and have no oxp.json runtime contract.
 *
 * This keeps the CLI honest: VSX entries are explicitly delegated to
 * the IDE, and we surface that in CLI output so the user knows what
 * happened.
 */

import { spawnSync } from "node:child_process";

import type { DetectedHost } from "./host-detect.js";

export interface VsxInstallTarget {
  namespace: string;
  name: string;
  /** Optional; informational only. */
  version?: string;
}

export interface VsxInstallReport {
  host: DetectedHost;
  /** ok | skipped | failed */
  status: "ok" | "skipped" | "failed";
  /** Filled when status !== ok. */
  reason?: string;
  /** Captured stdout/stderr tail (truncated to 400 chars). */
  output?: string;
}

/**
 * Run `<cliPath> --install-extension <namespace>.<name>` against every
 * detected vscode-family host. JetBrains/Zed/Piye are reported as
 * skipped since they have no compatible install command for VSIX.
 */
export function installVsx(
  target: VsxInstallTarget,
  hosts: DetectedHost[],
): VsxInstallReport[] {
  const ext = `${target.namespace}.${target.name}`;
  const out: VsxInstallReport[] = [];
  for (const host of hosts) {
    if (host.family !== "vscode") {
      out.push({
        host,
        status: "skipped",
        reason: `family ${host.family} can't install VSIX via --install-extension`,
      });
      continue;
    }
    if (!host.cliPath) {
      out.push({
        host,
        status: "skipped",
        reason: "no CLI launcher on PATH",
      });
      continue;
    }
    const res = spawnSync(host.cliPath, ["--install-extension", ext], {
      encoding: "utf8",
      // Cap runtime so a hung IDE process can't block the CLI forever.
      timeout: 60_000,
    });
    const tail = (res.stdout || "") + (res.stderr || "");
    const trimmed = tail.length > 400 ? tail.slice(-400) : tail;
    if (res.error) {
      out.push({
        host,
        status: "failed",
        reason: res.error.message,
        output: trimmed,
      });
      continue;
    }
    if (res.status !== 0) {
      out.push({
        host,
        status: "failed",
        reason: `${host.cliPath} exited with code ${res.status}`,
        output: trimmed,
      });
      continue;
    }
    out.push({ host, status: "ok", output: trimmed });
  }
  return out;
}
