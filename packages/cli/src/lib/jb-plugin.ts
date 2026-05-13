/**
 * Shared JetBrains plugin vendor-install logic.
 *
 * Used by both ide-launch.ts (EDH flow) and host-adapter.ts (setup flow)
 * so the same vendored zip install path is always consistent.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface VendoredJetBrainsPlugin {
  zipPath: string;
  version: string;
  pluginId: string;
  /** Top-level directory inside the zip (`oxp-jetbrains`). */
  rootDir: string;
}

/**
 * Locate the vendored JetBrains plugin zip bundled with the CLI under
 * `packages/cli/vendor/`. Returns null when no zip is found.
 */
export function locateVendoredJetBrainsPlugin(): VendoredJetBrainsPlugin | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "vendor"),
    join(here, "..", "..", "..", "vendor"),
  ];
  for (const dir of candidates) {
    const manifestPath = join(dir, "oxp-jetbrains.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        pluginId: string;
        version: string;
        zipFile: string;
        rootDir: string;
      };
      const zip = join(dir, m.zipFile);
      if (!existsSync(zip)) continue;
      return {
        zipPath: zip,
        version: m.version,
        pluginId: m.pluginId,
        rootDir: m.rootDir,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Install (or upgrade) the vendored JetBrains plugin into `configDir`'s
 * `plugins/` folder. Idempotent — same version → no-op.
 *
 * Returns true on success or when already up-to-date. Returns false on
 * any extraction failure.
 */
export function installJetBrainsPlugin(
  plugin: VendoredJetBrainsPlugin,
  configDir: string,
): boolean {
  const pluginsDir = join(configDir, "plugins");
  const target = join(pluginsDir, plugin.rootDir);
  const stamp = join(target, ".oxp-installed-version");

  // Fast path: already at this version.
  if (existsSync(stamp)) {
    try {
      if (readFileSync(stamp, "utf8").trim() === plugin.version) return true;
    } catch {
      /* fall through to reinstall */
    }
  }

  try {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    mkdirSync(pluginsDir, { recursive: true });
  } catch {
    return false;
  }

  const r =
    process.platform === "win32"
      ? spawnSync("powershell", [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${plugin.zipPath}' -DestinationPath '${pluginsDir}' -Force`,
        ])
      : spawnSync("unzip", ["-oq", plugin.zipPath, "-d", pluginsDir]);

  if (r.status !== 0) return false;
  if (!existsSync(join(target, "lib"))) return false;

  try {
    writeFileSync(stamp, plugin.version, "utf8");
  } catch {
    /* non-fatal */
  }
  return true;
}
