/**
 * Host adapter management — ensure each detected IDE has the OXP host
 * adapter (the small extension that wires the IDE to the shared
 * `~/.oxp/host-store/`).
 *
 * For VS Code-family IDEs (VS Code, Cursor, Windsurf, VSCodium, Insiders)
 * the adapter is a single VSIX published to OpenVSX as
 * `oxprotocol.oxp-vscode`. The same VSIX works in every fork because
 * they all share the VS Code extension API surface.
 *
 * If the adapter VSIX hasn't been published yet (early-launch state),
 * `ensureAdapter` returns `{ status: "unavailable" }` instead of failing
 * — the install still proceeds, the user just won't see the extension
 * appear inside that IDE until the adapter ships. This keeps the smart
 * install flow forward-compatible.
 *
 * Auto-install is **silent** when:
 *   - the IDE has a CLI launcher available, AND
 *   - the adapter is not already present, AND
 *   - the user has not passed `--no-adapter`.
 *
 * The CLI never edits the IDE's user settings, never spawns a UI, and
 * never blocks waiting on a marketplace prompt — `<cli>
 * --install-extension <id>` is a one-shot command that exits 0 on
 * success.
 */

import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DetectedHost } from "./host-detect.js";

const exec = promisify(execFile);

/** Marketplace id of the VS Code-family host adapter. */
export const VSCODE_ADAPTER_ID = "oxprotocol.oxp-vscode";

/** JetBrains marketplace plugin id of the OXP host adapter. */
export const JETBRAINS_ADAPTER_ID = "sh.oxp.jetbrains";

/** Neovim plugin spec (lazy.nvim/packer source) for the OXP host adapter. */
export const NEOVIM_ADAPTER_REPO = "oxprotocol/oxp.nvim";

/** When true, auto-install will attempt to fetch the adapter from OpenVSX. */
const ADAPTER_PUBLISHED = true; // ✓ oxp-vscode VSIX published to OpenVSX

/** When true, auto-install will fetch the JetBrains plugin from JetBrains Marketplace. */
const JETBRAINS_ADAPTER_PUBLISHED = true; // ✓ sh.oxp.jetbrains published to JetBrains Marketplace

export type AdapterStatus =
  /** Adapter is already installed in this host. */
  | { status: "present"; host: DetectedHost }
  /** Adapter was just installed by us. */
  | { status: "installed"; host: DetectedHost }
  /** No adapter exists for this host family yet. */
  | { status: "unsupported"; host: DetectedHost }
  /** Adapter would be installable but the VSIX isn't published yet. */
  | { status: "unavailable"; host: DetectedHost; reason: string }
  /** Install was attempted and failed (best-effort; non-fatal). */
  | { status: "failed"; host: DetectedHost; error: string };

export interface EnsureOptions {
  /** When true, skip auto-install and only report status. */
  reportOnly?: boolean;
}

/**
 * Make sure each host in the list has the OXP adapter installed.
 * Returns a parallel array of statuses; never throws.
 */
export async function ensureAdapters(
  hosts: DetectedHost[],
  opts: EnsureOptions = {},
): Promise<AdapterStatus[]> {
  // Run in parallel — every probe / install is independent and bounded
  // by its own exec timeout.
  return Promise.all(hosts.map((h) => ensureAdapter(h, opts)));
}

export async function ensureAdapter(
  host: DetectedHost,
  opts: EnsureOptions = {},
): Promise<AdapterStatus> {
  if (host.family === "jetbrains") {
    return ensureJetBrainsAdapter(host, opts);
  }
  if (host.id === "neovim") {
    return ensureNeovimAdapter(host);
  }
  if (host.family !== "vscode") {
    return { status: "unsupported", host };
  }

  // Probe the extensions directory directly — it's the cheapest signal
  // and avoids spawning the IDE's CLI (which can be slow on cold start).
  if (host.extensionsDir && (await hasAdapterOnDisk(host.extensionsDir))) {
    return { status: "present", host };
  }

  // Some hosts (VSCodium, fresh installs) only expose the CLI listing.
  if (host.cliPath && (await hasAdapterViaCli(host.cliPath))) {
    return { status: "present", host };
  }

  if (!ADAPTER_PUBLISHED) {
    return {
      status: "unavailable",
      host,
      reason: "host adapter VSIX not published yet",
    };
  }

  if (opts.reportOnly || !host.cliPath) {
    return {
      status: "unavailable",
      host,
      reason: !host.cliPath ? "IDE CLI not on PATH" : "skipped (--report-only)",
    };
  }

  try {
    await exec(
      host.cliPath,
      ["--install-extension", VSCODE_ADAPTER_ID, "--force"],
      { timeout: 60_000 },
    );
    return { status: "installed", host };
  } catch (err) {
    return {
      status: "failed",
      host,
      error: (err as Error).message.split("\n")[0] ?? "install failed",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Probes                                                                     */
/* -------------------------------------------------------------------------- */

async function hasAdapterOnDisk(extensionsDir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(extensionsDir);
    return entries.some((name) =>
      name.toLowerCase().startsWith(`${VSCODE_ADAPTER_ID.toLowerCase()}-`),
    );
  } catch {
    return false;
  }
}

async function hasAdapterViaCli(cliPath: string): Promise<boolean> {
  try {
    const { stdout } = await exec(cliPath, ["--list-extensions"], {
      timeout: 5_000,
    });
    return stdout
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .includes(VSCODE_ADAPTER_ID.toLowerCase());
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* JetBrains adapter                                                          */
/* -------------------------------------------------------------------------- */

/**
 * For JetBrains we cannot silently install plugins from a CLI in the same
 * way as VS Code (the IDE has no `--install-plugin` flag in stable
 * channels). Instead we probe `<userDataDir>/plugins/oxp-jetbrains/` for
 * the marker the host plugin drops on first run, and otherwise return
 * `unavailable` with a clear human-readable next step.
 */
async function ensureJetBrainsAdapter(
  host: DetectedHost,
  _opts: EnsureOptions,
): Promise<AdapterStatus> {
  if (host.extensionsDir) {
    try {
      const entries = await fs.readdir(host.extensionsDir);
      const present = entries.some((n) => {
        const lower = n.toLowerCase();
        return (
          lower.startsWith("oxp-jetbrains") ||
          lower.startsWith("oxp.jetbrains") ||
          lower === "oxp"
        );
      });
      if (present) return { status: "present", host };
    } catch {
      // No plugins dir yet — fall through to "unavailable".
    }
  }
  if (!JETBRAINS_ADAPTER_PUBLISHED) {
    return {
      status: "unavailable",
      host,
      reason: "JetBrains plugin not published yet",
    };
  }
  return {
    status: "unavailable",
    host,
    reason: `install via Settings → Plugins → search "${JETBRAINS_ADAPTER_ID}"`,
  };
}

/* -------------------------------------------------------------------------- */
/* Neovim adapter                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Neovim plugins are git-managed by the user's plugin manager (lazy.nvim,
 * packer, vim-plug). We never write to the user's nvim config — instead we
 * probe the standard data dir for a clone of `oxp.nvim` and otherwise
 * report a one-line install snippet via `unavailable`.
 */
async function ensureNeovimAdapter(host: DetectedHost): Promise<AdapterStatus> {
  if (host.extensionsDir) {
    const present =
      (await pathExists(`${host.extensionsDir}/lazy/oxp.nvim`)) ||
      (await pathExists(
        `${host.extensionsDir}/site/pack/oxp/start/oxp.nvim`,
      )) ||
      (await pathExists(`${host.extensionsDir}/plugged/oxp.nvim`));
    if (present) return { status: "present", host };
  }
  return {
    status: "unavailable",
    host,
    reason: `add "${NEOVIM_ADAPTER_REPO}" to your plugin manager`,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
