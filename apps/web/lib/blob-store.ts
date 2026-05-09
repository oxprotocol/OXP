/**
 * Filesystem-backed bundle blob store.
 *
 * Layout: <BLOB_DIR>/<sha[0..2]>/<sha[2..4]>/<sha>.oxp
 *
 * Content-addressed by sha256 of the uncompressed tar (= bundleSha256).
 * Two-level fan-out keeps any single directory under a few thousand entries.
 *
 * In production this is swapped for S3/R2 by re-implementing the same four
 * functions. The route handlers do not know the difference.
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";

let _root: string | null = null;

/** Resolve the blob directory lazily so module load doesn't trip Turbopack's
 *  "fs operation at module scope" check.
 *
 *  Production (NODE_ENV=production) MUST set OXP_BLOB_DIR explicitly. We refuse
 *  to fall back to `process.cwd()/.oxp-blobs` in production because that would
 *  silently store published bundles under the deployed app directory, which is
 *  routinely wiped on redeploys (= bundle loss + signature-verification failures
 *  for already-installed extensions). Failing fast forces ops to mount a
 *  persistent volume.
 */
function blobRoot(): string {
  if (_root) return _root;
  const fromEnv = process.env.OXP_BLOB_DIR;
  if (!fromEnv) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "OXP_BLOB_DIR is required in production — refusing to use a cwd-relative blob root.",
      );
    }
    const fallback = join(process.cwd(), ".oxp-blobs");
    console.warn(
      `[blob-store] OXP_BLOB_DIR not set; using dev fallback ${fallback}`,
    );
    _root = resolve(fallback);
  } else {
    _root = resolve(fromEnv);
  }
  return _root;
}

function pathFor(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`blob: invalid sha256: ${sha256}`);
  }
  return join(
    blobRoot(),
    sha256.slice(0, 2),
    sha256.slice(2, 4),
    `${sha256}.oxp`,
  );
}

export async function putBundle(sha256: string, bytes: Buffer): Promise<void> {
  const dest = pathFor(sha256);
  await fs.mkdir(dirname(dest), { recursive: true });
  // Atomic-ish write
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, bytes, { mode: 0o644 });
  await fs.rename(tmp, dest);
}

export async function getBundle(sha256: string): Promise<Buffer> {
  return fs.readFile(pathFor(sha256));
}

export async function hasBundle(sha256: string): Promise<boolean> {
  try {
    await fs.access(pathFor(sha256));
    return true;
  } catch {
    return false;
  }
}

export async function deleteBundle(sha256: string): Promise<void> {
  try {
    await fs.unlink(pathFor(sha256));
  } catch {
    // ignore
  }
}

export const BLOB_ROOT = blobRoot;
