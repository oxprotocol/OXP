import { promises as fs } from "node:fs";
import { join, posix, relative, sep } from "node:path";

export interface DiscoveredFile {
  /** POSIX-relative path inside the bundle (e.g. "ui/index.html"). */
  path: string;
  /** Absolute on-disk path. */
  abs: string;
  size: number;
}

/**
 * Walk a directory and return all files (no directories, no symlinks),
 * with POSIX-style relative paths. Skips dot-paths under `.oxp/` and
 * `.git/` automatically; the caller decides what else to filter.
 */
export async function walk(root: string): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  await visit(root, root, out);
  return out;
}

async function visit(
  root: string,
  dir: string,
  out: DiscoveredFile[],
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in OXP bundles: ${abs}`);
    }
    if (e.isDirectory()) {
      // Skip VCS / build / dependency noise that's never part of a bundle.
      // `dist` is reserved for `oxp pack` output; `target` is Rust's
      // build cache (component-v1 projects); `node_modules` is for hosts
      // that bundle JS-side tooling alongside their .oxp source.
      if (
        e.name === ".git" ||
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === "target"
      )
        continue;
      await visit(root, abs, out);
      continue;
    }
    if (!e.isFile()) continue;
    const rel = relative(root, abs).split(sep).join(posix.sep);
    const stat = await fs.stat(abs);
    out.push({ path: rel, abs, size: stat.size });
  }
}
