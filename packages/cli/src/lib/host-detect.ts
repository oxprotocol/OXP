/**
 * Host detection — discover IDEs installed on the user's machine.
 *
 * The OXP install flow needs to know which editors are present so it can
 * (a) ensure the OXP host adapter is installed for each one, and
 * (b) report which environments the freshly-installed extension is now
 *     available in.
 *
 * Detection is **silent** and **best-effort**: a missing IDE is not an
 * error, and we never spawn a long-running probe. We look for the
 * canonical CLI binary on PATH and the canonical user-data / extensions
 * directories for each platform. If both exist we consider the IDE
 * installed; if only one is present the host is reported with
 * `partial: true` so the caller can decide whether to skip it.
 *
 * Supported families today:
 *   - VS Code, Cursor, Windsurf, VSCodium, VS Code Insiders
 *     (all share the same extension format → adapter VSIX is reusable)
 *
 * JetBrains, Zed, Theia, Gitpod, Coder are placeholders — detection is
 * stubbed so the surface stays stable as we add real probes.
 */

import { promises as fs } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { HostId } from "@oxprotocol/types";

const exec = promisify(execFile);

export interface DetectedHost {
  /** Canonical id from `@oxprotocol/types`. */
  id: HostId;
  /** Human-friendly name for CLI output. */
  displayName: string;
  /** Family this host belongs to (drives adapter strategy). */
  family: "vscode" | "jetbrains" | "zed" | "piye" | "other";
  /** Path to the IDE's command-line launcher, if found. */
  cliPath?: string;
  /** Path to the directory storing the user's installed extensions. */
  extensionsDir?: string;
  /** Path to the IDE's user-data dir (settings, globalStorage). */
  userDataDir?: string;
  /** True when both CLI and a user-data dir were located. */
  installed: boolean;
  /** True when only one of CLI / data-dir was found (still usable in some flows). */
  partial: boolean;
  /** True when we detected at least one running process for this IDE. */
  running: boolean;
}

interface VSCodeFamilyEntry {
  id: HostId;
  displayName: string;
  /** Binary name(s) on PATH, in priority order. */
  bin: readonly string[];
  /** macOS .app bundle names under /Applications and ~/Applications. */
  macApps: readonly string[];
  /** Subdirectory under ~/Library/Application Support and %APPDATA%. */
  userDataSubdir: string;
  /** Subdirectory under ~/  for the extensions store (Linux/macOS). */
  extensionsSubdir: string;
  /** Process name fragment to match in `ps` / `tasklist` output. */
  processFragment: string;
}

const VSCODE_FAMILY: readonly VSCodeFamilyEntry[] = [
  {
    id: "vscode",
    displayName: "VS Code",
    bin: ["code"],
    macApps: ["Visual Studio Code.app"],
    userDataSubdir: "Code",
    extensionsSubdir: ".vscode/extensions",
    processFragment: "Visual Studio Code",
  },
  {
    id: "vscode",
    displayName: "VS Code Insiders",
    bin: ["code-insiders"],
    macApps: ["Visual Studio Code - Insiders.app"],
    userDataSubdir: "Code - Insiders",
    extensionsSubdir: ".vscode-insiders/extensions",
    processFragment: "Visual Studio Code - Insiders",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    bin: ["cursor"],
    macApps: ["Cursor.app"],
    userDataSubdir: "Cursor",
    extensionsSubdir: ".cursor/extensions",
    processFragment: "Cursor",
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    bin: ["windsurf"],
    macApps: ["Windsurf.app"],
    userDataSubdir: "Windsurf",
    extensionsSubdir: ".windsurf/extensions",
    processFragment: "Windsurf",
  },
  {
    id: "vscodium",
    displayName: "VSCodium",
    bin: ["codium"],
    macApps: ["VSCodium.app"],
    userDataSubdir: "VSCodium",
    extensionsSubdir: ".vscode-oss/extensions",
    processFragment: "VSCodium",
  },
];

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface DetectOptions {
  /** Skip the `ps`/`tasklist` probe. Default: false. */
  skipProcessProbe?: boolean;
}

/**
 * Discover every supported IDE on the current machine. Returns only
 * hosts where we found *some* evidence of installation; absent IDEs are
 * silently omitted. Order is stable: VS Code family first (in the
 * declaration order above), then everything else.
 */
export async function detectHosts(
  opts: DetectOptions = {},
): Promise<DetectedHost[]> {
  const found: DetectedHost[] = [];

  // Capture process list once so we can tag every host without paying the
  // exec cost N times.
  const procList = opts.skipProcessProbe ? "" : await snapshotProcesses();

  for (const entry of VSCODE_FAMILY) {
    const host = await detectVSCodeFamily(entry, procList);
    if (host) found.push(host);
  }

  // JetBrains family — installs are per-product per-year (IntelliJIdea2025.2,
  // WebStorm2024.3, etc.). We collapse them into a single `jetbrains` entry
  // keyed on the newest installation found.
  const jb = await detectJetBrains(procList);
  if (jb) found.push(jb);

  // Neovim — `nvim` on PATH plus a config dir.
  const nv = await detectNeovim(procList);
  if (nv) found.push(nv);

  return found;
}

/**
 * Look up a single host by id. Convenience for `oxp install --host vscode`.
 * Returns undefined when not installed.
 */
export async function detectHost(
  id: HostId,
): Promise<DetectedHost | undefined> {
  const all = await detectHosts();
  return all.find((h) => h.id === id);
}

/* -------------------------------------------------------------------------- */
/* VS Code family probes                                                      */
/* -------------------------------------------------------------------------- */

async function detectVSCodeFamily(
  entry: VSCodeFamilyEntry,
  procList: string,
): Promise<DetectedHost | undefined> {
  const cliPath = await findCli(entry);
  const userDataDir = vscodeUserDataDir(entry.userDataSubdir);
  const extensionsDir = vscodeExtensionsDir(entry.extensionsSubdir);

  const userDataExists = await pathExists(userDataDir);
  const extDirExists = await pathExists(extensionsDir);
  const haveCli = !!cliPath;
  const haveData = userDataExists || extDirExists;

  if (!haveCli && !haveData) return undefined;

  const running =
    procList.length > 0 && procList.includes(entry.processFragment);

  return {
    id: entry.id,
    displayName: entry.displayName,
    family: "vscode",
    cliPath,
    extensionsDir: extDirExists ? extensionsDir : undefined,
    userDataDir: userDataExists ? userDataDir : undefined,
    installed: haveCli && haveData,
    partial: !(haveCli && haveData),
    running,
  };
}

/* -------------------------------------------------------------------------- */
/* Path helpers                                                               */
/* -------------------------------------------------------------------------- */

function vscodeUserDataDir(subdir: string): string {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", subdir);
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        subdir,
      );
    default:
      return join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        subdir,
      );
  }
}

function vscodeExtensionsDir(subdir: string): string {
  return join(homedir(), subdir);
}

/* -------------------------------------------------------------------------- */
/* CLI discovery                                                              */
/* -------------------------------------------------------------------------- */

async function findCli(entry: VSCodeFamilyEntry): Promise<string | undefined> {
  // 1) macOS app bundles ship the CLI inside Contents/Resources/app/bin
  if (platform() === "darwin") {
    for (const app of entry.macApps) {
      for (const root of ["/Applications", join(homedir(), "Applications")]) {
        for (const bin of entry.bin) {
          const p = join(root, app, "Contents", "Resources", "app", "bin", bin);
          if (await pathExists(p)) return p;
        }
      }
    }
  }

  // 2) Anything on PATH wins next.
  for (const bin of entry.bin) {
    const p = await whichBinary(bin);
    if (p) return p;
  }

  // 3) Common Linux/Windows install locations as a final fallback.
  const candidates = platformFallbackBins(entry);
  for (const p of candidates) {
    if (await pathExists(p)) return p;
  }
  return undefined;
}

function platformFallbackBins(entry: VSCodeFamilyEntry): string[] {
  if (platform() === "win32") {
    const local =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    const programs = process.env.ProgramFiles ?? "C:\\Program Files";
    return entry.bin.flatMap((b) => [
      join(local, "Programs", entry.displayName, "bin", `${b}.cmd`),
      join(programs, entry.displayName, "bin", `${b}.cmd`),
    ]);
  }
  // Linux / other unix
  return entry.bin.flatMap((b) => [
    `/usr/bin/${b}`,
    `/usr/local/bin/${b}`,
    `/snap/bin/${b}`,
    `/var/lib/flatpak/exports/bin/${b}`,
  ]);
}

async function whichBinary(bin: string): Promise<string | undefined> {
  // Prefer `command -v` over `which` — it's a POSIX builtin and works in
  // restricted PATHs. On Windows we fall back to `where`.
  const cmd = platform() === "win32" ? "where" : "command";
  const args = platform() === "win32" ? [bin] : ["-v", bin];
  try {
    const { stdout } = await exec(cmd, args, {
      shell: platform() !== "win32", // `command` is a builtin
      timeout: 1500,
    });
    const first = stdout.split(/\r?\n/).find((s) => s.trim().length > 0);
    return first?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Process probe                                                              */
/* -------------------------------------------------------------------------- */

async function snapshotProcesses(): Promise<string> {
  try {
    if (platform() === "win32") {
      const { stdout } = await exec("tasklist", [], { timeout: 2000 });
      return stdout;
    }
    const { stdout } = await exec("ps", ["-Aco", "command"], { timeout: 2000 });
    return stdout;
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* fs helpers                                                                 */
/* -------------------------------------------------------------------------- */

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* JetBrains family probe                                                     */
/* -------------------------------------------------------------------------- */

interface JetBrainsProduct {
  /** Folder prefix used in JetBrains config dirs (e.g. "IntelliJIdea"). */
  configPrefix: string;
  /** macOS .app bundle name. */
  macApp: string;
  /** CLI launcher names. */
  bin: readonly string[];
  /** Friendly display name. */
  displayName: string;
  /** Process fragment for `ps` matching. */
  processFragment: string;
}

const JETBRAINS_PRODUCTS: readonly JetBrainsProduct[] = [
  {
    configPrefix: "IntelliJIdea",
    macApp: "IntelliJ IDEA.app",
    bin: ["idea"],
    displayName: "IntelliJ IDEA",
    processFragment: "idea",
  },
  {
    configPrefix: "IntelliJIdea",
    macApp: "IntelliJ IDEA Ultimate.app",
    bin: ["idea"],
    displayName: "IntelliJ IDEA",
    processFragment: "idea",
  },
  {
    configPrefix: "IdeaIC",
    macApp: "IntelliJ IDEA CE.app",
    bin: ["idea"],
    displayName: "IntelliJ IDEA CE",
    processFragment: "idea",
  },
  {
    configPrefix: "WebStorm",
    macApp: "WebStorm.app",
    bin: ["webstorm"],
    displayName: "WebStorm",
    processFragment: "webstorm",
  },
  {
    configPrefix: "PyCharm",
    macApp: "PyCharm.app",
    bin: ["pycharm"],
    displayName: "PyCharm",
    processFragment: "pycharm",
  },
  {
    configPrefix: "PyCharmCE",
    macApp: "PyCharm CE.app",
    bin: ["pycharm"],
    displayName: "PyCharm CE",
    processFragment: "pycharm",
  },
  {
    configPrefix: "GoLand",
    macApp: "GoLand.app",
    bin: ["goland"],
    displayName: "GoLand",
    processFragment: "goland",
  },
  {
    configPrefix: "RustRover",
    macApp: "RustRover.app",
    bin: ["rustrover"],
    displayName: "RustRover",
    processFragment: "rustrover",
  },
  {
    configPrefix: "CLion",
    macApp: "CLion.app",
    bin: ["clion"],
    displayName: "CLion",
    processFragment: "clion",
  },
  {
    configPrefix: "RubyMine",
    macApp: "RubyMine.app",
    bin: ["mine"],
    displayName: "RubyMine",
    processFragment: "rubymine",
  },
  {
    configPrefix: "PhpStorm",
    macApp: "PhpStorm.app",
    bin: ["pstorm"],
    displayName: "PhpStorm",
    processFragment: "phpstorm",
  },
  {
    configPrefix: "DataGrip",
    macApp: "DataGrip.app",
    bin: ["datagrip"],
    displayName: "DataGrip",
    processFragment: "datagrip",
  },
  {
    configPrefix: "Rider",
    macApp: "Rider.app",
    bin: ["rider"],
    displayName: "Rider",
    processFragment: "rider",
  },
];

async function detectJetBrains(
  procList: string,
): Promise<DetectedHost | undefined> {
  const configRoot = jetBrainsConfigRoot();
  let configDirs: string[] = [];
  try {
    const entries = await fs.readdir(configRoot, { withFileTypes: true });
    configDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // No JetBrains configs at all → no JetBrains products installed.
  }

  // Find the newest config dir matching any known product prefix. The
  // dir name format is `<Prefix><Year>.<Minor>` (e.g. IntelliJIdea2025.2).
  let bestProduct: JetBrainsProduct | undefined;
  let bestConfig: string | undefined;
  let bestVersion = "";
  for (const dir of configDirs) {
    for (const p of JETBRAINS_PRODUCTS) {
      if (!dir.startsWith(p.configPrefix)) continue;
      const ver = dir.slice(p.configPrefix.length);
      if (!/^\d{4}\.\d+$/.test(ver)) continue;
      if (compareJbVersion(ver, bestVersion) > 0) {
        bestProduct = p;
        bestConfig = dir;
        bestVersion = ver;
      }
    }
  }

  // Also probe for an .app bundle on macOS even if no config dir exists yet.
  let cliPath: string | undefined;
  let macAppFound: JetBrainsProduct | undefined;
  if (platform() === "darwin") {
    for (const p of JETBRAINS_PRODUCTS) {
      for (const root of ["/Applications", join(homedir(), "Applications")]) {
        const app = join(root, p.macApp);
        if (await pathExists(app)) {
          macAppFound ??= p;
          // JetBrains ships a tiny launcher script under MacOS/<bin>
          for (const bin of p.bin) {
            const candidate = join(app, "Contents", "MacOS", bin);
            if (await pathExists(candidate)) {
              cliPath ??= candidate;
              break;
            }
          }
          break;
        }
      }
    }
  }

  // PATH lookup last (Toolbox often installs `idea`, `webstorm` shims).
  if (!cliPath) {
    const product = bestProduct ?? macAppFound;
    if (product) {
      for (const bin of product.bin) {
        const p = await whichBinary(bin);
        if (p) {
          cliPath = p;
          break;
        }
      }
    }
  }

  const product = bestProduct ?? macAppFound;
  if (!product && !cliPath && !bestConfig) return undefined;

  const userDataDir = bestConfig ? join(configRoot, bestConfig) : undefined;
  const extensionsDir = userDataDir ? join(userDataDir, "plugins") : undefined;
  const haveData = !!userDataDir && (await pathExists(userDataDir));
  const haveCli = !!cliPath;
  const running =
    procList.length > 0 &&
    !!product &&
    procList.toLowerCase().includes(product.processFragment);

  return {
    id: "jetbrains",
    displayName: product
      ? bestVersion
        ? `${product.displayName} ${bestVersion}`
        : product.displayName
      : "JetBrains IDE",
    family: "jetbrains",
    cliPath,
    extensionsDir,
    userDataDir,
    installed: haveCli && haveData,
    partial: !(haveCli && haveData),
    running,
  };
}

function jetBrainsConfigRoot(): string {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "JetBrains");
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "JetBrains",
      );
    default:
      return join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "JetBrains",
      );
  }
}

/** Compare "2025.2" vs "2024.3" — newer wins. Empty string sorts lowest. */
function compareJbVersion(a: string, b: string): number {
  if (!a) return -1;
  if (!b) return 1;
  const [ay, am] = a.split(".").map(Number);
  const [by, bm] = b.split(".").map(Number);
  if ((ay ?? 0) !== (by ?? 0)) return (ay ?? 0) - (by ?? 0);
  return (am ?? 0) - (bm ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Neovim probe                                                               */
/* -------------------------------------------------------------------------- */

async function detectNeovim(
  procList: string,
): Promise<DetectedHost | undefined> {
  const cliPath = await whichBinary("nvim");
  const configDir =
    platform() === "win32"
      ? join(
          process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
          "nvim",
        )
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "nvim");
  const dataDir =
    platform() === "win32"
      ? join(
          process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
          "nvim-data",
        )
      : join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
          "nvim",
        );

  const haveConfig = await pathExists(configDir);
  const haveData = await pathExists(dataDir);
  if (!cliPath && !haveConfig && !haveData) return undefined;

  const running = procList.length > 0 && /\bnvim\b/.test(procList);

  return {
    id: "neovim",
    displayName: "Neovim",
    family: "other",
    cliPath,
    extensionsDir: haveData ? dataDir : undefined,
    userDataDir: haveConfig ? configDir : undefined,
    installed: !!cliPath && haveConfig,
    partial: !(cliPath && haveConfig),
    running,
  };
}
