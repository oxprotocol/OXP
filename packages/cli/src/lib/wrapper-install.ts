/**
 * Native-extension wrapper installer.
 *
 * For every OXP extension installed into the shared store at
 * `~/.oxp/host-store/extensions/<publisher>/<slug>/<version>/`, we
 * also generate and install a tiny *wrapper VSIX* whose only purpose
 * is to give the extension a native Activity Bar item in VS Code-family
 * IDEs (VS Code, Cursor, …).
 *
 * The wrapper:
 *   - Declares its own `viewsContainers.activitybar` entry with the
 *     extension's own icon (so the Activity Bar shows the extension's
 *     visual identity, not a generic OXP slot).
 *   - Declares one `webview` view inside that container.
 *   - Depends on `oxprotocol.oxp-vscode` (the OXP host extension) and
 *     in its tiny activate() acquires the host's exported API to
 *     register the bridge-wired provider against its declared view.
 *
 * The OXP store is the source of truth — wrappers are just shells.
 * Uninstall = remove the wrapper (and let the host-store removal be
 * driven by whoever called `oxp uninstall`).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DetectedHost } from "./host-detect.js";

export interface WrapperInstallTarget {
  /** Canonical OXP id, e.g. `@aldgar/icon`. */
  oxpId: string;
  /** Publisher segment of the OXP id (without the `@`). */
  publisher: string;
  /** Slug segment of the OXP id. */
  slug: string;
  /** Installed version on disk. */
  version: string;
  /** Manifest display name (or `oxpId` if missing). */
  displayName: string;
  /** Absolute path to `~/.oxp/host-store/extensions/<pub>/<slug>/<ver>/`. */
  installDir: string;
  /** Manifest's `icon` field (relative path inside installDir), or null. */
  iconRel: string | null;
}

export interface WrapperInstallReport {
  host: DetectedHost;
  status: "ok" | "skipped" | "failed";
  reason?: string;
  /** Path to the generated VSIX (for diagnostics). */
  vsixPath?: string;
}

/**
 * Generate a wrapper VSIX for `target` and install it into every
 * detected VS Code-family host. Returns one report per host.
 */
export function installNativeWrappers(
  target: WrapperInstallTarget,
  hosts: DetectedHost[],
): WrapperInstallReport[] {
  const reports: WrapperInstallReport[] = [];
  // Build one VSIX, install it into every vscode-family host. Each host
  // copies the VSIX into its own extensions dir, so a single artifact
  // serves all of them.
  let vsixPath: string | null = null;
  let buildErr: string | null = null;
  try {
    vsixPath = buildWrapperVsix(target);
  } catch (err) {
    buildErr = (err as Error).message;
  }

  for (const host of hosts) {
    if (host.family !== "vscode") {
      reports.push({
        host,
        status: "skipped",
        reason: `family ${host.family} doesn't accept VSIX via --install-extension`,
      });
      continue;
    }
    if (!host.cliPath) {
      reports.push({
        host,
        status: "skipped",
        reason: "no CLI launcher on PATH",
      });
      continue;
    }
    if (buildErr || !vsixPath) {
      reports.push({
        host,
        status: "failed",
        reason: `wrapper VSIX build failed: ${buildErr ?? "unknown"}`,
      });
      continue;
    }
    const res = spawnSync(
      host.cliPath,
      ["--install-extension", vsixPath, "--force"],
      { encoding: "utf8", timeout: 60_000 },
    );
    if (res.error) {
      reports.push({
        host,
        status: "failed",
        reason: res.error.message,
        vsixPath,
      });
      continue;
    }
    if (res.status !== 0) {
      reports.push({
        host,
        status: "failed",
        reason:
          `${host.cliPath} exited with ${res.status}: ` +
          ((res.stdout || "") + (res.stderr || "")).trim().slice(-300),
        vsixPath,
      });
      continue;
    }
    reports.push({ host, status: "ok", vsixPath });
  }
  return reports;
}

/**
 * Uninstall the wrapper for an OXP extension by id. Computes the
 * derived VS Code extension id (`oxp.<pub>-<slug>` with slugified
 * segments, matching packaged wrappers) and runs the IDE CLI
 * uninstall against every vscode-family host.
 */
export function uninstallNativeWrappers(
  oxpId: string,
  hosts: DetectedHost[],
): WrapperInstallReport[] {
  const wrapperId = wrapperExtensionId(oxpId);
  const reports: WrapperInstallReport[] = [];
  for (const host of hosts) {
    if (host.family !== "vscode") {
      reports.push({
        host,
        status: "skipped",
        reason: `family ${host.family} doesn't accept --uninstall-extension`,
      });
      continue;
    }
    if (!host.cliPath) {
      reports.push({
        host,
        status: "skipped",
        reason: "no CLI launcher on PATH",
      });
      continue;
    }
    const res = spawnSync(
      host.cliPath,
      ["--uninstall-extension", wrapperId],
      { encoding: "utf8", timeout: 60_000 },
    );
    if (res.error) {
      reports.push({
        host,
        status: "failed",
        reason: res.error.message,
      });
      continue;
    }
    // Non-zero exit can mean "not installed", which is fine in the
    // common case of running uninstall twice.
    if (res.status !== 0) {
      reports.push({
        host,
        status: "skipped",
        reason: `not installed (exit ${res.status})`,
      });
      continue;
    }
    reports.push({ host, status: "ok" });
  }
  return reports;
}

/* -------------------------------------------------------------------------- */
/* Wrapper VSIX generation                                                    */
/* -------------------------------------------------------------------------- */

const HOST_EXTENSION_ID = "oxprotocol.oxp-vscode";

const WRAPPER_VSCODE_PUBLISHER = "oxp";

export function wrapperPackageName(oxpId: string): string {
  const stripped = oxpId.replace(/^@/, "");
  const [pub, slug] = stripped.split("/", 2);
  return `${slugify(pub ?? "x")}-${slugify(slug ?? "x")}`;
}

/** Installed VSIX id: `{publisher}.{name}` — mirrors `scripts/wrap-extension.mjs`. */
export function wrapperExtensionId(oxpId: string): string {
  return `${WRAPPER_VSCODE_PUBLISHER}.${wrapperPackageName(oxpId)}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
}

function viewContainerId(oxpId: string): string {
  // Contribution keys are independent of `{publisher}.{name}`; dotted
  // form is stable and matches proof-of-concept `wrap-extension.mjs`.
  const stripped = oxpId.replace(/^@/, "");
  const [pub, slug] = stripped.split("/", 2);
  return `oxp.${slugify(pub ?? "x")}.${slugify(slug ?? "x")}`;
}

/**
 * Build the wrapper VSIX into a temp dir and return its path. The
 * caller is responsible for invoking `<cli> --install-extension` on
 * the returned path.
 *
 * VSIX format is a zip with `extension.vsixmanifest`, `package.json`,
 * and whatever asset files the manifest references. We use the same
 * `@vscode/vsce` toolchain the host uses, packaged as a Node API.
 */
function buildWrapperVsix(target: WrapperInstallTarget): string {
  const stagingDir = path.join(
    tmpdir(),
    `oxp-wrapper-${Date.now()}-${process.pid}`,
  );
  mkdirSync(stagingDir, { recursive: true });

  // 1. Copy the extension icon into the staging dir under a stable
  //    name. If the extension doesn't ship an icon, fall back to a
  //    minimal embedded SVG so VS Code has something to render.
  const iconName = stageIcon(target, stagingDir);

  // 2. Write the wrapper's package.json. The view id and the
  //    viewsContainer id must match what `extension.js` registers
  //    against at runtime.
  const vscodeExtId = wrapperExtensionId(target.oxpId);
  const containerId = viewContainerId(target.oxpId);
  const viewId = `${containerId}.view`;
  const wrapperPkgName = wrapperPackageName(target.oxpId);

  const pkg = {
    name: wrapperPkgName,
    displayName: target.displayName,
    description: `OXP wrapper for ${target.oxpId}@${target.version}.`,
    version: target.version,
    publisher: WRAPPER_VSCODE_PUBLISHER,
    icon: iconName,
    engines: { vscode: "^1.95.0" },
    main: "./extension.js",
    extensionDependencies: [HOST_EXTENSION_ID],
    // Explorer panels are managed by the host via its pre-declared slot
    // views (oxp.explorer.slot.0 … 7) and ExplorerSlotManager — no
    // per-extension view contribution needed here.
    activationEvents: ["onStartupFinished"],
    contributes: {},
  };
  writeFileSync(
    path.join(stagingDir, "package.json"),
    JSON.stringify(pkg, null, 2),
  );

  // 3. Minimal extension.js — the wrapper's only job now is to ensure
  //    the OXP host is present and active. Explorer panels are managed
  //    by the host's ExplorerSlotManager; no WebviewViewProvider needed.
  const extensionJs = `
"use strict";
const vscode = require("vscode");

const HOST_ID = ${JSON.stringify(HOST_EXTENSION_ID)};

async function activate() {
  const host = vscode.extensions.getExtension(HOST_ID);
  if (!host) {
    vscode.window.showErrorMessage(
      "OXP Host is not installed. Install '" + HOST_ID + "' to use this extension."
    );
    return;
  }
  if (!host.isActive) {
    try { await host.activate(); } catch (err) {
      vscode.window.showErrorMessage(
        "Failed to activate OXP Host: " + (err && err.message ? err.message : String(err))
      );
    }
  }
}

function deactivate() {}

exports.activate = activate;
exports.deactivate = deactivate;
`;
  writeFileSync(path.join(stagingDir, "extension.js"), extensionJs);

  // 4. Bare-bones README so vsce doesn't warn.
  writeFileSync(
    path.join(stagingDir, "README.md"),
    `# ${target.displayName}\n\nOXP wrapper for \`${target.oxpId}@${target.version}\`.\n` +
      `\nThis is a generated extension. The implementation lives in the OXP host extension.\n`,
  );

  // 5. Package via vsce. We invoke the published CLI by name so we
  //    don't have to bundle vsce internals into the OXP CLI.
  const vsixPath = path.join(stagingDir, `${vscodeExtId}-${target.version}.vsix`);
  const res = spawnSync(
    "npx",
    [
      "--yes",
      "@vscode/vsce",
      "package",
      "--no-dependencies",
      "--out",
      vsixPath,
      "--skip-license",
    ],
    {
      cwd: stagingDir,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (res.error || res.status !== 0) {
    const detail =
      (res.error && res.error.message) ||
      `vsce exited with ${res.status}: ` +
        ((res.stdout || "") + (res.stderr || "")).trim().slice(-400);
    throw new Error(`vsce package failed: ${detail}`);
  }
  if (!existsSync(vsixPath)) {
    throw new Error(`vsce reported success but produced no VSIX at ${vsixPath}`);
  }
  return vsixPath;
}

/**
 * Stage the extension's icon into the wrapper directory. Returns the
 * staged filename (relative to the wrapper root).
 *
 * VS Code accepts `.svg`, `.png`, `.jpg`, `.gif` for both
 * `contributes.viewsContainers[].icon` and the top-level
 * `package.json#icon`. We just copy whatever the manifest declares.
 * If the extension didn't declare an icon, fall back to a minimal
 * generated SVG so VS Code never refuses the install.
 */
function stageIcon(target: WrapperInstallTarget, stagingDir: string): string {
  if (target.iconRel) {
    const source = path.join(target.installDir, target.iconRel);
    if (existsSync(source)) {
      const ext = path.extname(target.iconRel).toLowerCase() || ".svg";
      const dest = path.join(stagingDir, `icon${ext}`);
      try {
        copyFileSync(source, dest);
        return `icon${ext}`;
      } catch {
        /* fall through */
      }
    }
  }
  // Fallback: write a simple branded SVG placeholder so VS Code
  // doesn't reject the install for a missing icon path.
  const initial = (target.displayName || target.oxpId).trim().charAt(0).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="4" ry="4" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="16" text-anchor="middle" font-family="system-ui,Helvetica,Arial,sans-serif" font-size="11" font-weight="600">${escapeXml(initial)}</text></svg>`;
  writeFileSync(path.join(stagingDir, "icon.svg"), svg);
  return "icon.svg";
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "&" ? "&amp;" :
    c === '"' ? "&quot;" : "&apos;"
  );
}

/**
 * Read the on-disk manifest at the install dir and produce the
 * target descriptor needed by `installNativeWrappers`. Returns null
 * if the manifest can't be read or is malformed.
 */
export function readManifestForWrapper(
  installDir: string,
  oxpId: string,
): WrapperInstallTarget | null {
  const manifestPath = path.join(installDir, "oxp.json");
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const m = parsed as {
    id?: unknown;
    publisher?: unknown;
    version?: unknown;
    displayName?: unknown;
    icon?: unknown;
  };
  const id = typeof m.id === "string" ? m.id : oxpId;
  const stripped = id.replace(/^@/, "");
  const [pub, slug] = stripped.split("/", 2);
  const publisher = typeof m.publisher === "string" ? m.publisher : pub ?? "x";
  const version = typeof m.version === "string" ? m.version : "0.0.0";
  const displayName = typeof m.displayName === "string" ? m.displayName : id;
  const iconRel = typeof m.icon === "string" ? m.icon : null;
  return {
    oxpId: id,
    publisher,
    slug: slug ?? "x",
    version,
    displayName,
    installDir,
    iconRel,
  };
}

export function disposeWrapperBuildDir(vsixPath: string): void {
  // Best-effort cleanup of the temp staging dir. Failure is non-fatal
  // — these live in OS tmpdir and get reaped anyway.
  try {
    rmSync(path.dirname(vsixPath), { recursive: true, force: true });
  } catch {
    /* noop */
  }
}
