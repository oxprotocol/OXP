import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

export interface IntegrityManifest {
  specVersion: "1";
  algorithm: "sha-256";
  files: Record<string, string>;
}

export interface FileRef {
  path: string;
  abs: string;
  size: number;
}

/** sha256 of a buffer, hex (no "sha256:" prefix). */
export function digestBundle(tarBytes: Buffer): string {
  return createHash("sha256").update(tarBytes).digest("hex");
}

/**
 * Compute the per-file integrity manifest written to `.oxp/integrity.json`.
 * Files are sorted lexicographically by path.
 */
export async function computeIntegrityManifest(
  files: FileRef[],
): Promise<IntegrityManifest> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  const out: Record<string, string> = {};
  for (const f of sorted) {
    const buf = await fs.readFile(f.abs);
    out[f.path] = createHash("sha256").update(buf).digest("hex");
  }
  return { specVersion: "1", algorithm: "sha-256", files: out };
}
