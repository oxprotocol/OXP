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
 *
 * Honours an optional `.oxpignore` file at the root: each non-empty,
 * non-comment line is treated as a literal path (relative to the root)
 * to skip. A trailing `/` marks a directory; otherwise both files and
 * directories matching that path are skipped.
 */
export async function walk(root: string): Promise<DiscoveredFile[]> {
  const ignore = await readIgnoreFile(root);
  const out: DiscoveredFile[] = [];
  await visit(root, root, out, ignore);
  return out;
}

interface IgnoreSet {
  files: ReadonlySet<string>;
  dirs: ReadonlySet<string>;
}

async function readIgnoreFile(root: string): Promise<IgnoreSet> {
  const files = new Set<string>();
  const dirs = new Set<string>();
  try {
    const raw = await fs.readFile(join(root, ".oxpignore"), "utf8");
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      // Normalise to POSIX, strip leading ./, drop leading /
      const norm = line
        .replace(/^\.\//, "")
        .replace(/^\//, "")
        .split(sep)
        .join(posix.sep);
      if (norm.endsWith("/")) {
        dirs.add(norm.slice(0, -1));
      } else {
        // Treat as both: a file at this exact path, or a directory of
        // that name. This matches the common .gitignore expectation
        // ("src" should ignore the whole src/ tree).
        files.add(norm);
        dirs.add(norm);
      }
    }
  } catch {
    /* no .oxpignore — fine */
  }
  return { files, dirs };
}

async function visit(
  root: string,
  dir: string,
  out: DiscoveredFile[],
  ignore: IgnoreSet,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in OXP bundles: ${abs}`);
    }
    const rel = relative(root, abs).split(sep).join(posix.sep);
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
      if (ignore.dirs.has(rel)) continue;
      await visit(root, abs, out, ignore);
      continue;
    }
    if (!e.isFile()) continue;
    if (ignore.files.has(rel)) continue;
    const stat = await fs.stat(abs);
    out.push({ path: rel, abs, size: stat.size });
  }
}
