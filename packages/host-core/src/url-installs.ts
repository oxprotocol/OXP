/**
 * Shared "URL-installed extensions" registry.
 *
 * `fetchBundle` caches raw `.wasm` files by sha256 — useful, but headless.
 * This module adds a *named* layer on top: each install records its source
 * URL, suggested id, install timestamp, and (optionally) the user's granted
 * permissions, so any IDE host can list and re-load URL installs without
 * the user having to remember the original URL.
 *
 * Layout (under `<oxpHome>/host-store/url-installs/<sha256>/`):
 *   bundle.wasm          ← raw bytes (also the fetchBundle cache target)
 *   meta.json            ← UrlInstallRecord
 *
 * Both VS Code and JetBrains hosts read `listUrlInstalls(root)` to populate
 * the "URL extensions" section of their UIs.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

export interface UrlInstallRecord {
  /** sha256 of the .wasm bytes (lowercase hex). Also the directory name. */
  sha256: string;
  /** Original source URL, exactly as provided. */
  sourceUrl: string;
  /** Suggested extension id. Defaults to `@url/<basename>`. */
  suggestedId: string;
  /** Bytes on disk. */
  size: number;
  /** ISO-8601. */
  installedAt: string;
  /** Capability ids the user approved at install time, if known. */
  grantedPermissions?: string[];
}

const DIR = "url-installs";
const BUNDLE = "bundle.wasm";
const META = "meta.json";

/** Absolute path to the URL-installs root directory. */
export function urlInstallRoot(hostStoreRoot: string): string {
  return path.join(hostStoreRoot, DIR);
}

/**
 * Persist a URL-installed bundle. `bundleBytes` is written to
 * `<root>/<sha>/bundle.wasm` and the metadata to `meta.json`. Idempotent —
 * re-installing the same sha overwrites `meta.json` (so `installedAt` /
 * `sourceUrl` reflect the latest install) and leaves the bytes alone.
 *
 * Returns the directory and the record that was written.
 */
export async function recordUrlInstall(
  hostStoreRoot: string,
  bundleBytes: Uint8Array,
  args: {
    sha256: string;
    sourceUrl: string;
    suggestedId?: string;
    grantedPermissions?: readonly string[];
  },
): Promise<{ dir: string; bundlePath: string; record: UrlInstallRecord }> {
  const root = urlInstallRoot(hostStoreRoot);
  const dir = path.join(root, args.sha256);
  await mkdir(dir, { recursive: true });

  const bundlePath = path.join(dir, BUNDLE);
  // Skip the byte write if a same-sized file is already there — sha256 is
  // a content hash, so equal length is a strong signal we already have it.
  let existing: number | null = null;
  try {
    existing = (await stat(bundlePath)).size;
  } catch {
    /* not present */
  }
  if (existing !== bundleBytes.length) {
    await writeFile(bundlePath, bundleBytes);
  }

  const suggestedId = args.suggestedId ?? defaultSuggestedId(args.sourceUrl);
  const record: UrlInstallRecord = {
    sha256: args.sha256,
    sourceUrl: args.sourceUrl,
    suggestedId,
    size: bundleBytes.length,
    installedAt: new Date().toISOString(),
    ...(args.grantedPermissions !== undefined && {
      grantedPermissions: [...args.grantedPermissions],
    }),
  };
  await writeFile(path.join(dir, META), JSON.stringify(record, null, 2));
  return { dir, bundlePath, record };
}

/**
 * List every URL install under `<hostStoreRoot>/url-installs/`. Skips any
 * directory missing a `meta.json` or `bundle.wasm` (treat as half-written).
 * Returns records newest-first by `installedAt`.
 */
export async function listUrlInstalls(
  hostStoreRoot: string,
): Promise<Array<UrlInstallRecord & { bundlePath: string }>> {
  const root = urlInstallRoot(hostStoreRoot);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const out: Array<UrlInstallRecord & { bundlePath: string }> = [];
  for (const sha of entries) {
    const dir = path.join(root, sha);
    const bundlePath = path.join(dir, BUNDLE);
    const metaPath = path.join(dir, META);
    try {
      await stat(bundlePath);
      const raw = await readFile(metaPath, "utf8");
      const rec = JSON.parse(raw) as UrlInstallRecord;
      out.push({ ...rec, bundlePath });
    } catch {
      // Skip half-written / corrupted entries.
    }
  }
  out.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
  return out;
}

function defaultSuggestedId(sourceUrl: string): string {
  let name = "remote";
  try {
    const u = new URL(sourceUrl);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const base = last.replace(/\.wasm$/i, "");
    if (base) name = base;
  } catch {
    /* fall through */
  }
  return `@url/${name}`;
}
