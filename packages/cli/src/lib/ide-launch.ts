/**
 * Generic IDE detection + auto-install for `oxp dev`.
 *
 * No hardcoded list of IDEs. We detect the IDE that owns the current
 * terminal by walking the parent process to its application bundle /
 * install directory, then read VS Code's own `product.json` manifest
 * — every VS Code fork (Cursor, Windsurf, Antigravity, VSCodium, …)
 * ships one with the IDE's display name and CLI binary name. From
 * there we use the bundled CLI inside the install to install the host
 * VSIX and (if launched outside the IDE) open a new window.
 *
 * This works for any current or future VS Code-compatible IDE without
 * code changes.
 *
 * Override: `--ide=<bin>` (or env `OXP_IDE`) forces a CLI binary name.
 * Debug:    `--debug`    (or env `OXP_DEBUG=1`).
 */
import { spawn, spawnSync as nodeSpawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync as nodeRenameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { info } from "../util.js";
import { writeEdhMarker } from "./edh-marker.js";

// ── Vendored host VSIX ────────────────────────────────────────────────────

interface VendoredVsix {
  vsixPath: string;
  version: string;
  extensionId: string;
}

function locateVendoredVsix(): VendoredVsix | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "vendor"),
    join(here, "..", "..", "..", "vendor"),
  ];
  for (const dir of candidates) {
    const manifestPath = join(dir, "oxp-vscode.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        extensionId: string;
        version: string;
        vsixFile: string;
      };
      const vsix = join(dir, m.vsixFile);
      if (!existsSync(vsix)) continue;
      return {
        vsixPath: vsix,
        version: m.version,
        extensionId: m.extensionId,
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ── Vendored JetBrains plugin zip ─────────────────────────────────────────
// Shared logic lives in jb-plugin.ts; re-exported here for convenience.

import {
  locateVendoredJetBrainsPlugin,
  installJetBrainsPlugin as installJetBrainsPluginShared,
} from "./jb-plugin.js";

// ── Vendored Neovim plugin tarball ────────────────────────────────────────

interface VendoredNeovimPlugin {
  archivePath: string;
  version: string;
  pluginName: string;
  /** Top-level directory inside the tarball (`oxp.nvim`). */
  rootDir: string;
}

function locateVendoredNeovimPlugin(): VendoredNeovimPlugin | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "vendor"),
    join(here, "..", "..", "..", "vendor"),
  ];
  for (const dir of candidates) {
    const manifestPath = join(dir, "oxp-neovim.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        pluginName: string;
        version: string;
        archiveFile: string;
        rootDir: string;
      };
      const archive = join(dir, m.archiveFile);
      if (!existsSync(archive)) continue;
      return {
        archivePath: archive,
        version: m.version,
        pluginName: m.pluginName,
        rootDir: m.rootDir,
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ── Spawn helper ───────────────────────────────────────────────────────────

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function spawnSync(cmd: string, args: string[]): SpawnResult {
  const r = nodeSpawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function commandExists(bin: string): boolean {
  if (!bin) return false;
  const which = process.platform === "win32" ? "where" : "which";
  return spawnSync(which, [bin]).status === 0;
}

// ── Detection ──────────────────────────────────────────────────────────────

/**
 * The output of detection. Either we know the IDE (and have a CLI to
 * drive) or we don't.
 */
interface DetectedIde {
  /** Human display name from product.json (`nameLong`) or app folder. */
  name: string;
  /** CLI binary name from product.json (`applicationName`) or derived. */
  bin: string;
  /** Absolute path to the bundled CLI inside the install (preferred). */
  binPath?: string;
  /** Root of the install: `/Applications/Cursor.app` or `/usr/share/cursor`. */
  installRoot?: string;
  /** Did we read this from a product.json? */
  fromProductJson: boolean;
  /** Detection source for `--debug`. */
  source: string;
}

interface ProductJson {
  nameLong?: string;
  nameShort?: string;
  applicationName?: string;
}

/**
 * Look for `<root>/Contents/Resources/app/product.json` (macOS .app) or
 * `<root>/resources/app/product.json` (Linux/Windows install). Returns
 * the parsed manifest if present.
 */
function readProductJson(installRoot: string): {
  product: ProductJson;
  appDir: string;
} | null {
  const tries = [
    join(installRoot, "Contents", "Resources", "app"),
    join(installRoot, "resources", "app"),
  ];
  for (const appDir of tries) {
    const p = join(appDir, "product.json");
    if (!existsSync(p)) continue;
    try {
      const product = JSON.parse(readFileSync(p, "utf8")) as ProductJson;
      return { product, appDir };
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * From an arbitrary executable path, walk up to the install root.
 * On macOS the boundary is `*.app/`. On Linux/Windows, walk up until
 * we find a directory containing `resources/app/product.json`.
 */
function findInstallRoot(execPath: string): string | null {
  // macOS .app boundary
  const m = /^(.*?\.app)(\/|$)/.exec(execPath);
  if (m && m[1]) return m[1];
  // Linux/Windows: walk up looking for resources/app/product.json
  let dir = dirname(execPath);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "resources", "app", "product.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Locate the bundled CLI inside a VS Code-family install. The CLI is at
 * `<install>/Contents/Resources/app/bin/<applicationName>` on macOS or
 * `<install>/bin/<applicationName>` on Linux/Windows.
 */
function findBundledCli(installRoot: string, appName: string): string | null {
  if (!appName) return null;
  const candidates = [
    join(installRoot, "Contents", "Resources", "app", "bin", appName),
    join(installRoot, "bin", appName),
    join(installRoot, "bin", `${appName}.cmd`),
    join(installRoot, "bin", `${appName}.exe`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/** Best-effort: get an ancestor process's executable path. */
function getProcessExecPath(pid: number): string | null {
  if (!pid || pid <= 1) return null;
  if (process.platform === "linux") {
    try {
      return readlinkSync(`/proc/${pid}/exe`);
    } catch {
      // fall through
    }
  }
  if (process.platform === "darwin") {
    // `comm=` returns the executable path *without* arguments, so paths
    // containing spaces (e.g. "IntelliJ IDEA.app", "Visual Studio
    // Code.app") survive intact. `command=` would include args, forcing
    // us to split on whitespace and truncating those names.
    const r = spawnSync("ps", ["-o", "comm=", "-p", String(pid)]);
    if (r.status === 0) {
      const line = r.stdout.replace(/\r?\n$/, "");
      if (line) return line;
    }
  }
  if (process.platform === "linux") {
    // /proc above is the primary path; this is the fallback.
    const r = spawnSync("ps", ["-o", "comm=", "-p", String(pid)]);
    if (r.status === 0) {
      const line = r.stdout.replace(/\r?\n$/, "");
      if (line) return line;
    }
  }
  if (process.platform === "win32") {
    const r = spawnSync("wmic", [
      "process",
      "where",
      `ProcessId=${pid}`,
      "get",
      "ExecutablePath",
      "/value",
    ]);
    if (r.status === 0) {
      const m = /ExecutablePath=(.+)/.exec(r.stdout);
      if (m && m[1]) return m[1].trim();
    }
  }
  return null;
}

/** Get a process's parent PID (macOS/Linux). */
function getParentPid(pid: number): number | null {
  if (process.platform === "darwin" || process.platform === "linux") {
    const r = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)]);
    if (r.status === 0) {
      const n = Number(r.stdout.trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  if (process.platform === "win32") {
    const r = spawnSync("wmic", [
      "process",
      "where",
      `ProcessId=${pid}`,
      "get",
      "ParentProcessId",
      "/value",
    ]);
    if (r.status === 0) {
      const m = /ParentProcessId=(\d+)/.exec(r.stdout);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** Walk up the process tree collecting exec paths (parent first, up to 8). */
function getAncestorExecPaths(): { pid: number; exec: string }[] {
  const out: { pid: number; exec: string }[] = [];
  let pid: number | null = process.ppid || null;
  for (let i = 0; pid && i < 8; i++) {
    const exec = getProcessExecPath(pid);
    if (exec) out.push({ pid, exec });
    pid = getParentPid(pid);
  }
  return out;
}

/** Back-compat shim for the debug printer. */
function getParentExecPath(): string | null {
  return getProcessExecPath(process.ppid || 0);
}

/**
 * Try to derive the IDE from any path we have: parent process, or any
 * env var whose value points into a VS Code-family install.
 */
function detectFromPath(execPath: string, source: string): DetectedIde | null {
  const root = findInstallRoot(execPath);
  if (!root) return null;
  const product = readProductJson(root);
  if (product) {
    const name =
      product.product.nameLong ||
      product.product.nameShort ||
      basename(root).replace(/\.app$/i, "");
    const bin = product.product.applicationName || guessBinFromRoot(root);
    const binPath = findBundledCli(root, bin);
    return {
      name,
      bin,
      binPath: binPath ?? undefined,
      installRoot: root,
      fromProductJson: true,
      source: `${source} → ${root}`,
    };
  }
  // No product.json — best-effort name guess from folder
  const name = basename(root).replace(/\.app$/i, "");
  const bin = guessBinFromRoot(root);
  const binPath = findBundledCli(root, bin);
  return {
    name,
    bin,
    binPath: binPath ?? undefined,
    installRoot: root,
    fromProductJson: false,
    source: `${source} → ${root} (no product.json)`,
  };
}

function basename(p: string): string {
  const parts = p.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function guessBinFromRoot(root: string): string {
  return basename(root)
    .replace(/\.app$/i, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** Env vars whose values often hold an IDE-internal path. */
const PATH_BEARING_ENV_VARS = [
  "VSCODE_GIT_ASKPASS_NODE",
  "VSCODE_GIT_ASKPASS_MAIN",
  "VSCODE_IPC_HOOK",
  "VSCODE_IPC_HOOK_CLI",
  "VSCODE_CWD",
  "TERM_PROGRAM_PATH",
  "GIT_ASKPASS",
  "_",
];

export function detectIde(): DetectedIde | null {
  // 1. Walk the whole process tree. Direct parent is usually `npx`/`node`
  //    when invoked by an extension host; the IDE is a few hops up.
  for (const { exec, pid } of getAncestorExecPaths()) {
    const fromAncestor = detectFromPath(exec, `ancestor pid=${pid} ${exec}`);
    if (fromAncestor) return fromAncestor;
  }

  // 2. If this terminal belongs to a non-VS-Code IDE (JetBrains, Neovim,
  //    Piye, …), STOP. Do not fall back to env-var scanning — env may
  //    leak `.app/` paths from a previously-focused VS Code window and
  //    we'd end up popping that on top of the user's actual IDE. The
  //    caller (`launchIdeForDev`) handles non-VS-Code recognition
  //    separately and prints a hint.
  if (recognizeNonVscodeIde()) return null;

  // 3. Trusted VS Code env vars. These are guaranteed to point at the
  //    *current* IDE (they're set by the integrated terminal itself).
  for (const key of PATH_BEARING_ENV_VARS) {
    const v = process.env[key];
    if (!v) continue;
    const fromEnv = detectFromPath(v, `env ${key}`);
    if (fromEnv) return fromEnv;
  }

  return null;
}

// ── Debug ─────────────────────────────────────────────────────────────────

function printDebug(detected: DetectedIde | null): void {
  info("── oxp dev: IDE detection debug ──");
  info(`  platform: ${process.platform}`);
  info(`  ppid:     ${process.ppid}`);
  const ancestors = getAncestorExecPaths();
  info("  ancestors (parent first):");
  if (ancestors.length === 0) info("    <none resolved>");
  for (const a of ancestors) info(`    pid=${a.pid}  ${a.exec}`);
  if (detected) {
    info(`  detected: ${detected.name}  (bin=${detected.bin})`);
    info(`  source:   ${detected.source}`);
    info(`  install:  ${detected.installRoot ?? "<n/a>"}`);
    info(`  binPath:  ${detected.binPath ?? "<falls back to PATH lookup>"}`);
    info(`  product:  ${detected.fromProductJson ? "yes" : "no"}`);
  } else {
    info("  detected: <none>");
  }
  const interesting = [
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "__CFBundleIdentifier",
    "VSCODE_GIT_ASKPASS_NODE",
    "VSCODE_IPC_HOOK_CLI",
  ];
  info("  env:");
  for (const k of interesting) {
    const v = process.env[k];
    if (v) info(`    ${k}=${v.length > 100 ? v.slice(0, 97) + "…" : v}`);
  }
  info("──────────────────────────────────");
}

// ── Drive the IDE ─────────────────────────────────────────────────────────

const HOST_EXTENSION_ID = "oxp.oxp-vscode";

function resolveCli(ide: DetectedIde): string | null {
  if (ide.binPath) return ide.binPath;
  if (ide.bin && commandExists(ide.bin)) return ide.bin;
  return null;
}

function openEdhWindow(
  cli: string,
  extDir: string,
  projectRoot: string,
): boolean {
  // The same mechanism VS Code's F5 uses:
  //   <cli> --extensionDevelopmentPath=<extDir> --new-window <workspace>
  // The spawned window's title bar becomes
  // "[Extension Development Host]" and our host extension is loaded
  // from `extDir` instead of from the user's installed-extensions list.
  try {
    const child = spawn(
      cli,
      [`--extensionDevelopmentPath=${extDir}`, "--new-window", projectRoot],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract the host VSIX into `$OXP_HOME/edh-host/<version>/` and return
 * the inner `extension/` directory — the layout VS Code expects for
 * `--extensionDevelopmentPath`. VSIX is just a ZIP; the inside is
 *
 *   extension/
 *     package.json
 *     dist/extension.js
 *     …
 *   extension.vsixmanifest
 *   [Content_Types].xml
 *
 * We re-extract whenever the cached stamp is older than the VSIX so
 * host upgrades during development pick up automatically.
 */
function extractHostForEdh(vsix: VendoredVsix): string | null {
  const home =
    process.env.OXP_HOME ??
    join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".oxp");
  const root = join(home, "edh-host", vsix.version);
  const extDir = join(root, "extension");
  const stamp = join(root, ".ready");

  let needsExtract = !existsSync(stamp);
  if (!needsExtract) {
    try {
      if (statSync(vsix.vsixPath).mtimeMs > statSync(stamp).mtimeMs) {
        needsExtract = true;
      }
    } catch {
      needsExtract = true;
    }
  }

  if (needsExtract) {
    try {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
    } catch (err) {
      info(`✖ failed to prepare ${root}: ${(err as Error).message}`);
      return null;
    }
    const r =
      process.platform === "win32"
        ? spawnSync("powershell", [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${vsix.vsixPath}' -DestinationPath '${root}' -Force`,
          ])
        : spawnSync("unzip", ["-oq", vsix.vsixPath, "-d", root]);
    if (r.status !== 0) {
      info(
        `✖ failed to extract VSIX: ${r.stderr.trim() || "exit " + r.status}`,
      );
      return null;
    }
    try {
      // touch ready stamp
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("node:fs") as typeof import("node:fs")).writeFileSync(
        stamp,
        "",
        "utf8",
      );
    } catch {
      /* noop */
    }
  }

  if (!existsSync(join(extDir, "package.json"))) {
    info(`✖ extracted VSIX missing extension/package.json at ${extDir}`);
    return null;
  }
  return extDir;
}

/**
 * Stage the user-declared activity-bar icon into the extracted EDH host
 * folder. The host's `package.json` always points at
 * `media/active-icon.svg`; we overwrite that one file each spawn.
 *
 * Source: `<projectRoot>/oxp.json#icon` (relative path inside the
 * project). Falls back to the bundled OXP brand icon if:
 *   • `oxp.json` has no `icon` field
 *   • the declared path is outside the project root (path-traversal guard)
 *   • the file does not exist
 *
 * VS Code reads viewsContainer icons at extension load; staging must
 * happen BEFORE we spawn the EDH window.
 */
function stageActivityBarIcon(
  extDir: string,
  projectRoot: string,
  debug: boolean,
): void {
  const liveSlot = join(extDir, "media", "active-icon.svg");
  const defaultIcon = join(extDir, "media", "oxp-icon.svg");

  let source = defaultIcon;
  let reason = "default (no oxp.json#icon)";

  try {
    const raw = readFileSync(join(projectRoot, "oxp.json"), "utf8");
    const m = JSON.parse(raw) as { icon?: unknown };
    const rel = typeof m.icon === "string" ? m.icon.trim() : "";
    if (rel) {
      // Reject absolute paths and traversal — icon must live inside the
      // project root. Same containment check semantics as `oxp pack`.
      if (isAbsolute(rel) || rel.includes("..")) {
        reason = `rejected unsafe path: ${rel}`;
      } else {
        const candidate = join(projectRoot, rel);
        if (!candidate.startsWith(projectRoot + sep)) {
          reason = `rejected path outside project: ${rel}`;
        } else if (!existsSync(candidate)) {
          reason = `declared icon not found: ${rel}`;
        } else {
          source = candidate;
          reason = `oxp.json#icon=${rel}`;
        }
      }
    }
  } catch {
    /* no oxp.json or unreadable — fall through to default */
  }

  try {
    mkdirSync(dirname(liveSlot), { recursive: true });
    copyFileSync(source, liveSlot);
    if (debug) info(`  icon: ${reason} → media/active-icon.svg`);
  } catch (err) {
    info(`  ⚠ failed to stage activity-bar icon: ${(err as Error).message}`);
  }
}

// ── Non-VS-Code IDE recognition ───────────────────────────────────────────
//
// These IDEs don't share VS Code's extension format, so we can't auto-
// install the host. We only need to *recognize* them so we don't pop a
// VS Code window on top of the user's session. Each rule below uses an
// official, documented env var that the IDE itself sets — same kind of
// signal we use for VS Code (VSCODE_GIT_ASKPASS_NODE).

interface NonVscodeIde {
  name: string;
  hint: string;
}

function recognizeNonVscodeIde(): NonVscodeIde | null {
  const env = process.env;

  // Neovim sets NVIM (channel address) for any :terminal it spawns.
  if (env.NVIM || env.NVIM_LISTEN_ADDRESS) {
    return {
      name: "Neovim",
      hint: "The OXP plugin will be auto-installed on first run.",
    };
  }

  // Every JetBrains IDE sets TERMINAL_EMULATOR=JetBrains-JediTerm in its
  // built-in terminal — IntelliJ, WebStorm, PyCharm, GoLand, Rider, …
  if ((env.TERMINAL_EMULATOR ?? "").includes("JetBrains")) {
    return {
      name: "JetBrains IDE",
      hint: "The OXP plugin will be auto-installed on first run.",
    };
  }

  // Piye sets its own session var.
  if (env.PIYE_SESSION || env.PIYE_VERSION) {
    return {
      name: "Piye",
      hint: "Install the OXP Piye host from `hosts/piye` to attach.",
    };
  }

  return null;
}

// ── JetBrains detection + launch ──────────────────────────────────────────
//
// JetBrains IDEs don't share VS Code's extension format, but they all
// share a uniform layout: a single executable inside
// `<install>/Contents/MacOS/<bin>` (macOS) or `<install>/bin/<bin>(64)?`
// (Linux/Windows). That executable accepts a project path as its sole
// positional argument and opens it as a new project window in the same
// IDE process. That's exactly the UX we need for EDH: a fresh window
// scoped to the project, with our plugin (pre-installed from the
// Marketplace) attaching to the running `oxp dev` over the WS URL in
// the EDH marker.
//
// We never install the plugin — that path is owned by the user. We only
// spawn the IDE window and drop the marker.

/** All known JetBrains main-binary basenames across every flagship IDE. */
const JETBRAINS_BINS = new Set<string>([
  "idea",
  "idea64",
  "pycharm",
  "pycharm64",
  "webstorm",
  "webstorm64",
  "goland",
  "goland64",
  "rider",
  "rider64",
  "rustrover",
  "rustrover64",
  "clion",
  "clion64",
  "datagrip",
  "datagrip64",
  "phpstorm",
  "phpstorm64",
  "rubymine",
  "rubymine64",
  "dataspell",
  "dataspell64",
  "aqua",
  "aqua64",
]);

interface DetectedJetBrains {
  /** Display name (e.g. "IntelliJ IDEA"). */
  name: string;
  /** Absolute path to the IDE executable we'll spawn. */
  execPath: string;
  /** Short binary name without extension (`idea`, `webstorm`, …). */
  bin: string;
  /** How we figured this out — printed by --debug. */
  source: string;
}

/** Strip a trailing `.exe` and convert to lowercase basename. */
function execBasename(p: string): string {
  return basename(p)
    .replace(/\.exe$/i, "")
    .toLowerCase();
}

function detectJetBrainsIde(): DetectedJetBrains | null {
  for (const { exec, pid } of getAncestorExecPaths()) {
    const base = execBasename(exec);
    if (!JETBRAINS_BINS.has(base)) continue;
    // Derive a human name from the .app folder when available.
    const appMatch = /\/([^/]+)\.app\//.exec(exec);
    const name = appMatch?.[1] ?? base;
    return {
      name,
      execPath: exec,
      bin: base.replace(/64$/, ""),
      source: `ancestor pid=${pid} ${exec}`,
    };
  }
  return null;
}

function spawnJetBrainsWindow(exec: string, projectRoot: string): boolean {
  try {
    const child = spawn(exec, [projectRoot], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ── JetBrains plugin auto-install ─────────────────────────────────────────
//
// Mirrors how the VS Code path vendors the host as an unpacked extension
// directory (`extractHostForEdh`). For JetBrains we can't drop our
// plugin onto `--extensionDevelopmentPath` — the platform has no such
// flag — so instead we install it the way the IDE itself does:
//
//   1. Locate the IDE's per-user config dir
//      (macOS: ~/Library/Application Support/JetBrains/<Product><Version>;
//       Linux: ~/.config/JetBrains/<Product><Version>;
//       Windows: %APPDATA%\JetBrains\<Product><Version>).
//   2. Unpack the vendored plugin zip into `<configDir>/plugins/<rootDir>`.
//   3. Stamp the install with the vendored version so we only re-extract
//      on upgrade.
//
// The IDE picks up new plugins on its next start, which is exactly the
// fresh window we're about to spawn — so install must happen BEFORE
// `spawnJetBrainsWindow`.

/** Map JetBrains executable basename → set of plausible config-dir prefixes. */
const JETBRAINS_PRODUCT_PREFIXES: Record<string, readonly string[]> = {
  idea: ["IntelliJIdea", "IdeaIC"],
  pycharm: ["PyCharm", "PyCharmCE"],
  webstorm: ["WebStorm"],
  goland: ["GoLand"],
  rider: ["Rider"],
  rustrover: ["RustRover"],
  clion: ["CLion"],
  datagrip: ["DataGrip"],
  phpstorm: ["PhpStorm"],
  rubymine: ["RubyMine"],
  dataspell: ["DataSpell"],
  aqua: ["Aqua"],
};

function jetBrainsConfigRoot(): string | null {
  if (process.platform === "darwin") {
    const home = process.env.HOME;
    if (!home) return null;
    return join(home, "Library", "Application Support", "JetBrains");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return join(appData, "JetBrains");
  }
  // Linux + other Unixes — XDG-compliant since 2020.x.
  const xdg = process.env.XDG_CONFIG_HOME;
  const home = process.env.HOME;
  if (xdg) return join(xdg, "JetBrains");
  if (home) return join(home, ".config", "JetBrains");
  return null;
}

/**
 * Pick the per-user JetBrains config directory we should install into,
 * matching the IDE we're about to spawn. Returns the newest matching
 * directory by version suffix, or null if none exist yet.
 *
 * `bin` is the short executable basename (`idea`, `webstorm`, …).
 */
function pickJetBrainsConfigDir(bin: string): string | null {
  const root = jetBrainsConfigRoot();
  if (!root || !existsSync(root)) return null;
  const prefixes = JETBRAINS_PRODUCT_PREFIXES[bin.toLowerCase()];
  if (!prefixes || prefixes.length === 0) return null;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }

  const matches: { name: string; version: string }[] = [];
  for (const name of entries) {
    for (const pfx of prefixes) {
      if (name.startsWith(pfx)) {
        // Strip prefix to leave the version suffix (e.g. "2025.1").
        matches.push({ name, version: name.slice(pfx.length) });
        break;
      }
    }
  }
  if (matches.length === 0) return null;
  // Sort by version descending; "2026.1" > "2025.3" > "2025.1".
  matches.sort((a, b) => compareJbVersions(b.version, a.version));
  return join(root, matches[0]!.name);
}

function compareJbVersions(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map((s) => parseInt(s, 10));
  const pb = b.split(/[.\-]/).map((s) => parseInt(s, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i];
    const bi = pb[i];
    const an = Number.isFinite(ai) ? (ai as number) : 0;
    const bn = Number.isFinite(bi) ? (bi as number) : 0;
    if (an !== bn) return an - bn;
  }
  return 0;
}


function launchJetBrainsForDev(
  projectRoot: string,
  wsUrl: string,
  ideOverride: string | undefined,
  debug: boolean,
): boolean {
  // 1. Resolve which JetBrains IDE to drive.
  let detected = detectJetBrainsIde();

  // `--ide=<bin>` lets the user force a specific JetBrains binary on
  // PATH (e.g. a Toolbox-generated `idea` shim).
  if (ideOverride) {
    if (!JETBRAINS_BINS.has(ideOverride.toLowerCase())) {
      // Allow arbitrary names too — Toolbox sometimes generates
      // `idea-2024.3` etc. We just need it on PATH.
    }
    if (!commandExists(ideOverride)) {
      info(`✖ --ide=${ideOverride}: '${ideOverride}' is not on PATH.`);
      info(
        "  In JetBrains: Toolbox App → Settings → Generate shell scripts → " +
          "add the scripts directory to PATH.",
      );
      return false;
    }
    detected = {
      name: ideOverride,
      execPath: ideOverride, // PATH lookup handles it
      bin: ideOverride.toLowerCase(),
      source: `--ide=${ideOverride}`,
    };
  }

  if (!detected) {
    info("");
    info("▸ JetBrains IDE detected, but couldn't locate the IDE executable.");
    info("  Re-run with `--ide=<bin>` (e.g. --ide=idea, --ide=webstorm) or");
    info(
      "  generate JetBrains shell scripts (Toolbox App → Settings → " +
        "Generate shell scripts).",
    );
    return false;
  }

  if (debug) {
    info(`▸ targeting JetBrains ${detected.name}`);
    info(`  exec:   ${detected.execPath}`);
    info(`  source: ${detected.source}`);
  } else {
    info(`▸ targeting JetBrains ${detected.name}`);
  }

  // 2. Drop the EDH marker so the plugin attaches to *this* CLI's WS.
  try {
    const p = writeEdhMarker({
      folderPath: projectRoot,
      wsUrl,
      forkBin: detected.bin,
    });
    if (debug) info(`  marker: ${p}`);
  } catch (err) {
    info(`  ⚠ failed to write EDH marker: ${(err as Error).message}`);
    return false;
  }

  // 3. Auto-install (or upgrade) the vendored plugin into the IDE's
  //    per-user config dir. Mirrors `code --install-extension` for the
  //    VS Code path: a single bundled host shipped by the CLI, no
  //    manual Marketplace step.
  const plugin = locateVendoredJetBrainsPlugin();
  if (plugin) {
    const configDir = pickJetBrainsConfigDir(detected.bin);
    if (!configDir) {
      info(
        `  ⚠ no existing ${detected.name} config dir found — start the IDE` +
          " once so it creates one, then re-run `oxp dev`.",
      );
    } else {
      const installed = installJetBrainsPluginShared(plugin, configDir);
      if (installed) {
        info(`✓ OXP plugin installed (${plugin.version})`);
      } else {
        info("  ⚠ continuing without plugin auto-install");
      }
    }
  } else if (debug) {
    info("  no vendored JetBrains plugin zip found in packages/cli/vendor/");
  }

  // 4. Spawn the IDE window. JetBrains opens each project in its own
  //    window inside a single IDE process; passing the project path is
  //    enough to bring up a fresh window. Our plugin's `EdhStartupActivity`
  //    will fire on project open, see the marker, and attach to wsUrl.
  info(
    `▸ opening Extension Development Host (${detected.name}) for ${projectRoot}…`,
  );
  if (!spawnJetBrainsWindow(detected.execPath, projectRoot)) {
    info(`✖ failed to spawn ${detected.execPath}`);
    return false;
  }
  return true;
}

// ── Neovim detection + launch ─────────────────────────────────────────────
//
// Neovim's EDH is structurally different from VS Code / JetBrains:
//
//   * No second window — the EDH lives in a *new tab* of the same
//     Neovim instance that ran `oxp dev`. Neovim exposes its RPC API
//     over `$NVIM` (a unix socket) for any child process to drive.
//   * No WebSocket client in Lua — pure-Lua WS would be ~300 lines of
//     RFC6455 framing for very little gain. We already own the dev
//     server, so we push reload state out-of-band: write
//     `bundle.oxp` + `state.json` to a per-session cache dir and
//     remote-call `:lua require('oxp.dev').refresh()` to nudge the
//     plugin.
//   * Auto-install: extract the vendored tarball into
//     `<XDG_DATA_HOME>/nvim/site/pack/oxp/start/oxp.nvim/`. Anything
//     under `pack/*/start/*` is on `runtimepath` automatically on
//     Neovim startup — no `:packadd`, no user action.

function neovimPackpathRoot(): string {
  // The "site" dir is XDG-aware on macOS/Linux and uses
  // %LOCALAPPDATA%/nvim-data on Windows. We replicate Neovim's own
  // `stdpath('data')` defaults instead of asking nvim to print it
  // (avoids a process spawn just to get a path).
  if (process.platform === "win32") {
    const local =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(local, "nvim-data", "site", "pack", "oxp", "start");
  }
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdg, "nvim", "site", "pack", "oxp", "start");
}

function installNeovimPlugin(
  plugin: VendoredNeovimPlugin,
  packRoot: string,
  debug: boolean,
): string | null {
  const target = join(packRoot, plugin.rootDir);
  const stamp = join(target, ".oxp-installed-version");

  // Fast path: same version already installed.
  if (existsSync(stamp)) {
    try {
      const installed = readFileSync(stamp, "utf8").trim();
      if (installed === plugin.version) {
        if (debug) info(`  plugin: ${plugin.version} already at ${target}`);
        return target;
      }
    } catch {
      /* fall through to reinstall */
    }
  }

  try {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    mkdirSync(packRoot, { recursive: true });
  } catch (err) {
    info(`✖ failed to prepare ${packRoot}: ${(err as Error).message}`);
    return null;
  }

  // tar(1) is on every macOS/Linux box and on Windows 10+ since 1803.
  // The vendored archive is laid out as `oxp.nvim/{lua,plugin,VERSION}`
  // so extracting into packRoot is enough — no flattening dance.
  const r = spawnSync("tar", ["-xzf", plugin.archivePath, "-C", packRoot]);
  if (r.status !== 0) {
    info(
      `✖ failed to extract Neovim plugin: ${r.stderr.trim() || "exit " + r.status}`,
    );
    return null;
  }

  if (!existsSync(join(target, "lua", "oxp", "dev.lua"))) {
    info(`✖ extracted plugin missing lua/oxp/dev.lua at ${target}`);
    return null;
  }

  try {
    writeFileSync(stamp, plugin.version, "utf8");
  } catch {
    /* non-fatal */
  }
  return target;
}

/**
 * Bridge object returned by `launchNeovimForDev`: the dev-server loop
 * funnels every `broadcast({kind:"reload"|"error"|"shutdown"})` through
 * `onBroadcast`. We translate those messages into:
 *
 *   * `bundle.oxp`  — the latest packed bundle on disk (so the plugin
 *     can `oxp.install(path, …)` without re-encoding).
 *   * `state.json`  — a tiny status descriptor the plugin polls on each
 *     refresh nudge.
 *
 * The plugin only ever reads files; it never opens a socket itself.
 */
export interface NeovimBridge {
  /** Forward a dev-server broadcast into the EDH plugin. */
  onBroadcast(msg: { kind: string; [k: string]: unknown }): void;
  /** Best-effort `:OxpDevDetach` and remove the session dir. */
  dispose(): void;
}

interface NeovimReloadMsg {
  kind: "reload";
  manifest: Record<string, unknown>;
  digest: string;
  bundle: string; // base64
  builtAt: number;
  dev: boolean;
}

interface NeovimErrorMsg {
  kind: "error";
  message: string;
}

function isReload(m: { kind: string }): m is NeovimReloadMsg {
  return m.kind === "reload";
}
function isError(m: { kind: string }): m is NeovimErrorMsg {
  return m.kind === "error";
}

function launchNeovimForDev(
  projectRoot: string,
  wsUrl: string,
  debug: boolean,
): NeovimBridge | null {
  void wsUrl; // reserved for a future Lua WS client; ignored for now

  // 1. Confirm we're talking to a Neovim that exposes its RPC socket.
  const nvimAddr = process.env.NVIM ?? process.env.NVIM_LISTEN_ADDRESS;
  if (!nvimAddr) {
    info(
      "▸ Neovim detected, but $NVIM is not set in this terminal.\n" +
        "  Re-run `oxp dev` from inside a Neovim `:terminal` so we can\n" +
        "  drive the EDH tab via the running instance's RPC socket.",
    );
    return null;
  }
  if (!commandExists("nvim")) {
    info("✖ `nvim` is not on PATH — cannot drive the EDH tab.");
    return null;
  }

  info("▸ targeting Neovim (via $NVIM)");

  // 2. Vendor → install the plugin.
  const plugin = locateVendoredNeovimPlugin();
  if (!plugin) {
    info("  ⚠ no vendored Neovim plugin found in packages/cli/vendor/");
    return null;
  }
  const packRoot = neovimPackpathRoot();
  const installed = installNeovimPlugin(plugin, packRoot, debug);
  if (!installed) return null;
  info(`✓ OXP plugin installed (${plugin.version})`);
  if (debug) info(`  at: ${installed}`);

  // 3. Prepare the per-session bridge dir. We key on the CLI pid so a
  //    second `oxp dev` running concurrently doesn't clobber the first.
  const sessionDir = join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "oxp",
    `dev-${process.pid}`,
  );
  try {
    mkdirSync(sessionDir, { recursive: true });
  } catch (err) {
    info(`✖ failed to create session dir: ${(err as Error).message}`);
    return null;
  }
  if (debug) info(`  session: ${sessionDir}`);

  // 4. Tell the *already-newly-loaded* plugin to open the EDH tab. The
  //    running Neovim might have been started before the plugin was
  //    installed — runtimepath is finalised at startup, so we have to
  //    `:set rtp+=` and `:runtime` to pick up the freshly-extracted
  //    plugin/oxp.lua. After that, :OxpDevAttach is a registered
  //    user-command we can call.
  const runtimePath = process.env.OXP_RUNTIME ?? "oxp-runtime";
  const luaInit =
    `vim.opt.runtimepath:append(${luaQuote(installed)});` +
    `vim.cmd('runtime! plugin/oxp.lua');` +
    `require('oxp.dev').attach(${luaQuote(projectRoot)},` +
    `${luaQuote(runtimePath)},${luaQuote(sessionDir)})`;
  const remoteSendArg = `<C-\\><C-N>:lua ${luaInit}<CR>`;

  const r = spawnSync("nvim", [
    "--server",
    nvimAddr,
    "--remote-send",
    remoteSendArg,
  ]);
  if (r.status !== 0) {
    info(
      `✖ failed to attach Neovim EDH: ${r.stderr.trim() || "exit " + r.status}`,
    );
    return null;
  }
  info(`▸ opening Extension Development Host (Neovim) for ${projectRoot}…`);

  // 5. Build the broadcast bridge. We write files atomically (write to
  //    `.tmp` + rename) so the plugin never sees a half-written
  //    state.json mid-poll.
  const bundlePath = join(sessionDir, "bundle.oxp");
  const statePath = join(sessionDir, "state.json");

  function writeAtomic(path: string, data: Buffer | string): void {
    const tmp = path + ".tmp";
    writeFileSync(tmp, data);
    // rename(2) is atomic on the same filesystem. Node's `fs.renameSync`
    // wraps it on POSIX; on Windows it's a MoveFileEx with REPLACE_EXISTING.
    nodeRenameSync(tmp, path);
  }

  function nudge(): void {
    // Fire-and-forget — we don't care about the exit status. If the
    // user closed the EDH tab, the next nudge will no-op cleanly.
    try {
      const child = spawn(
        "nvim",
        [
          "--server",
          nvimAddr!,
          "--remote-send",
          "<C-\\><C-N>:lua require('oxp.dev').refresh()<CR>",
        ],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
    } catch {
      /* ignore */
    }
  }

  return {
    onBroadcast(msg) {
      if (isReload(msg)) {
        try {
          writeAtomic(bundlePath, Buffer.from(msg.bundle, "base64"));
          writeAtomic(
            statePath,
            JSON.stringify({
              status: "ready",
              session_dir: sessionDir,
              bundle_path: bundlePath,
              manifest: msg.manifest,
              built_at: msg.builtAt,
              error: null,
            }),
          );
          nudge();
        } catch (err) {
          info(`  ⚠ neovim bridge write failed: ${(err as Error).message}`);
        }
        return;
      }
      if (isError(msg)) {
        try {
          writeAtomic(
            statePath,
            JSON.stringify({
              status: "error",
              session_dir: sessionDir,
              error: msg.message,
              built_at: Date.now(),
            }),
          );
          nudge();
        } catch {
          /* ignore */
        }
        return;
      }
      if (msg.kind === "shutdown") {
        try {
          writeAtomic(
            statePath,
            JSON.stringify({
              status: "shutdown",
              session_dir: sessionDir,
              built_at: Date.now(),
            }),
          );
          nudge();
        } catch {
          /* ignore */
        }
      }
    },
    dispose() {
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/** Lua single-quoted string literal — escape backslash + single-quote. */
function luaQuote(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

// `launchIdeForDev` keeps its boolean return for backward compat; when
// the target is Neovim we stash the bridge here so dev.ts can grab it
// via `takeNeovimBridge()` after the call. Single-shot — taking it
// clears the slot so a subsequent `oxp dev` invocation starts clean.
let pendingNeovimBridge: NeovimBridge | null = null;

/**
 * Consume the bridge produced by the most recent `launchIdeForDev`
 * call. Returns null if the target wasn't Neovim.
 */
export function takeNeovimBridge(): NeovimBridge | null {
  const b = pendingNeovimBridge;
  pendingNeovimBridge = null;
  return b;
}

// ── Public entry point ────────────────────────────────────────────────────

export interface LaunchOptions {
  /** `--ide=<bin>` override — literal CLI binary name. */
  ideOverride?: string;
  /** Print detection details. */
  debug?: boolean;
  /**
   * WebSocket URL the EDH window should connect to. When provided we
   * write an EDH marker so the spawned IDE window auto-attaches without
   * spawning its own `oxp dev` (one CLI process per session).
   */
  wsUrl?: string;
}

export function launchIdeForDev(
  projectRoot: string,
  opts: LaunchOptions = {},
): boolean {
  const debug = opts.debug ?? process.env.OXP_DEBUG === "1";
  const override = opts.ideOverride ?? process.env.OXP_IDE;

  // ── JetBrains family ─────────────────────────────────────────────
  // Decide BEFORE VS Code detection: a JetBrains terminal must never
  // pop a VS Code window. We route via JetBrains if either:
  //   • the override names a known JetBrains binary, or
  //   • the surrounding terminal is JetBrains-JediTerm.
  // The plugin is installed by the user from JetBrains Marketplace; we
  // just drop the EDH marker and spawn a new project window.
  const overrideLc = override?.toLowerCase();
  const overrideIsJetBrains =
    !!overrideLc &&
    (JETBRAINS_BINS.has(overrideLc) ||
      JETBRAINS_BINS.has(overrideLc + "64") ||
      /^(idea|pycharm|webstorm|goland|rider|rustrover|clion|datagrip|phpstorm|rubymine|dataspell|aqua)([-_].+)?$/.test(
        overrideLc,
      ));
  const overrideIsNeovim =
    !!overrideLc && (overrideLc === "nvim" || overrideLc === "neovim");
  const nonVscode = recognizeNonVscodeIde();

  // ── Neovim ───────────────────────────────────────────────────────
  // Neovim's EDH lives inside the *running* Neovim. We return a bridge
  // object via the side channel so dev.ts can plumb broadcast → plugin.
  if (overrideIsNeovim || nonVscode?.name === "Neovim") {
    if (!opts.wsUrl) {
      info("✖ internal: launchIdeForDev requires wsUrl for Neovim targets");
      return false;
    }
    const bridge = launchNeovimForDev(projectRoot, opts.wsUrl, debug);
    if (bridge) {
      pendingNeovimBridge = bridge;
      return true;
    }
    return false;
  }

  if (overrideIsJetBrains || nonVscode?.name === "JetBrains IDE") {
    if (!opts.wsUrl) {
      info("✖ internal: launchIdeForDev requires wsUrl for JetBrains targets");
      return false;
    }
    return launchJetBrainsForDev(projectRoot, opts.wsUrl, override, debug);
  }

  // ── VS Code family ───────────────────────────────────────────────
  const vsix = locateVendoredVsix();
  if (!vsix) {
    info("ℹ︎ no bundled host VSIX found — skipping IDE auto-launch");
    return false;
  }

  const detected = detectIde();
  if (debug) printDebug(detected);

  // Resolve target.
  let ide: DetectedIde | null = detected;
  let isCurrent = !!detected;

  if (override) {
    // User forced a binary name. Use it directly.
    if (!commandExists(override)) {
      info(`✖ --ide=${override}: '${override}' is not on PATH.`);
      info(
        "  Install your IDE's shell command (Command Palette → \"Install 'xxx' command in PATH\")",
      );
      return false;
    }
    ide = {
      name: override,
      bin: override,
      fromProductJson: false,
      source: `--ide=${override}`,
    };
    isCurrent = detected?.bin === override;
  }

  if (!ide) {
    // Non-VS-Code IDE that isn't JetBrains (Neovim, Piye, …). We don't
    // bundle plugins for them yet — print a hint and let the user
    // connect manually.
    if (nonVscode) {
      info("");
      info(`▸ detected ${nonVscode.name}.`);
      info(
        `  No host plugin is bundled for ${nonVscode.name} yet — the dev backend`,
      );
      info(
        "  is running and any OXP host can connect to ws://localhost:<port>/dev",
      );
      info(`  (see banner above). ${nonVscode.hint}`);
      return true;
    }

    info("");
    info("ℹ︎ Could not detect an IDE from this terminal.");
    info("  • Run `oxp dev` from inside your IDE's terminal, or");
    info("  • Pass `--ide=<bin>` (e.g. --ide=cursor, --ide=code), or");
    info("  • Re-run with `--debug` to see what we saw.");
    return false;
  }

  const cli = resolveCli(ide);
  if (!cli) {
    info(`✖ ${ide.name}: could not find a CLI to drive.`);
    info(
      `  Install ${ide.name}'s shell command (Command Palette → "Install '${ide.bin}' command in PATH"),`,
    );
    info("  or re-run with --ide=<bin> pointing at a CLI on your PATH.");
    return false;
  }

  info(`▸ targeting ${ide.name}  (${ide.source})`);

  // Prepare the host as an unpacked extension directory. We feed this
  // path to the IDE via `--extensionDevelopmentPath`, the same flag VS
  // Code's F5 uses. No `--install-extension` step — the EDH window
  // loads the host from disk for this session only, leaving the user's
  // installed-extensions list untouched.
  const extDir = extractHostForEdh(vsix);
  if (!extDir) {
    info("  (extraction failed — aborting auto-launch)");
    return false;
  }
  if (debug) info(`  host extension dir: ${extDir}`);

  // Stage the user's activity-bar icon into the host's live-slot path
  // BEFORE spawning EDH — viewsContainer icons are read at extension
  // load, not refreshed at runtime.
  stageActivityBarIcon(extDir, projectRoot, debug);

  // Drop the EDH marker BEFORE spawning the window so activation reads
  // a populated marker. The marker carries the WS URL so the EDH window
  // attaches directly to this running CLI instead of spawning its own.
  if (opts.wsUrl) {
    try {
      const p = writeEdhMarker({
        folderPath: projectRoot,
        wsUrl: opts.wsUrl,
        forkBin: ide.bin,
      });
      if (debug) info(`  marker: ${p}`);
    } catch (err) {
      info(`  ⚠ failed to write EDH marker: ${(err as Error).message}`);
    }
  }

  // Spawn a proper Extension Development Host window. The flag pair
  // `--extensionDevelopmentPath=<dir> --new-window <folder>` is the
  // exact mechanism VS Code uses for F5; it works on every VS Code
  // fork (Cursor, Windsurf, Antigravity, VSCodium, …). The new window
  // gets a "[Extension Development Host]" title and loads our host
  // extension scoped to that window only.
  info(
    `▸ opening Extension Development Host (${ide.name}) for ${projectRoot}…`,
  );
  if (!openEdhWindow(cli, extDir, projectRoot)) {
    info(`✖ failed to spawn ${cli}`);
    return false;
  }
  if (isCurrent) {
    info(
      `  (a new ${ide.name} window will appear — its title shows "[Extension Development Host]")`,
    );
  }
  return true;
}
