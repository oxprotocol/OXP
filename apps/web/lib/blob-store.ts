/**
 * Bundle blob store.
 *
 * Layout: <BLOB_DIR>/<sha[0..2]>/<sha[2..4]>/<sha>.oxp
 *
 * Content-addressed by sha256 of the uncompressed tar (= bundleSha256).
 * Two-level fan-out keeps any single directory under a few thousand entries.
 *
 * Backends:
 *   - "vercel-blob": @vercel/blob (recommended for Vercel deploys — survives
 *     redeploys; auto-configured when BLOB_READ_WRITE_TOKEN is present).
 *   - "fs": local filesystem (dev only; will lose data on Vercel because the
 *     filesystem is ephemeral).
 *
 * Selection rules:
 *   - If OXP_BLOB_BACKEND is set, it wins.
 *   - Else if BLOB_READ_WRITE_TOKEN is present (Vercel injects this when the
 *     project has a Blob store attached), use "vercel-blob".
 *   - Else fall back to "fs". Production+fs is refused unless OXP_BLOB_DIR is
 *     set explicitly (forces ops to opt in to the unsafe path).
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  put as blobPut,
  head as blobHead,
  del as blobDel,
} from "@vercel/blob";

type Backend = "vercel-blob" | "fs";

let _backend: Backend | null = null;
function backend(): Backend {
  if (_backend) return _backend;
  const explicit = process.env.OXP_BLOB_BACKEND as Backend | undefined;
  if (explicit === "vercel-blob" || explicit === "fs") {
    _backend = explicit;
  } else if (process.env.BLOB_READ_WRITE_TOKEN) {
    _backend = "vercel-blob";
  } else {
    _backend = "fs";
  }
  return _backend;
}

/* -------------------------------------------------------------------------- */
/* Filesystem backend                                                          */
/* -------------------------------------------------------------------------- */

let _root: string | null = null;
function blobRoot(): string {
  if (_root) return _root;
  const fromEnv = process.env.OXP_BLOB_DIR;
  if (!fromEnv) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "OXP_BLOB_DIR is required when using the 'fs' backend in production. " +
          "Either attach a Vercel Blob store (sets BLOB_READ_WRITE_TOKEN) or " +
          "mount a persistent volume and set OXP_BLOB_DIR.",
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

function fsPathFor(sha256: string): string {
  return join(
    blobRoot(),
    sha256.slice(0, 2),
    sha256.slice(2, 4),
    `${sha256}.oxp`,
  );
}

/* -------------------------------------------------------------------------- */
/* Vercel Blob backend                                                         */
/* -------------------------------------------------------------------------- */

/** Object key inside the blob store. Same fan-out scheme as the fs path. */
function blobKey(sha256: string): string {
  return `bundles/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.oxp`;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

function assertSha(sha256: string): void {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`blob: invalid sha256: ${sha256}`);
  }
}

export async function putBundle(sha256: string, bytes: Buffer): Promise<void> {
  assertSha(sha256);
  if (backend() === "vercel-blob") {
    await blobPut(blobKey(sha256), bytes, {
      access: "public",
      contentType: "application/vnd.oxp.bundle.v1.tar+zstd",
      addRandomSuffix: false,
      allowOverwrite: true, // content-addressed — same sha = same bytes
      cacheControlMaxAge: 31536000,
    });
    return;
  }
  const dest = fsPathFor(sha256);
  await fs.mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, bytes, { mode: 0o644 });
  await fs.rename(tmp, dest);
}

export async function getBundle(sha256: string): Promise<Buffer> {
  assertSha(sha256);
  if (backend() === "vercel-blob") {
    const meta = await blobHead(blobKey(sha256));
    const res = await fetch(meta.url);
    if (!res.ok) {
      throw new Error(`blob: fetch failed ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  return fs.readFile(fsPathFor(sha256));
}

export async function hasBundle(sha256: string): Promise<boolean> {
  assertSha(sha256);
  if (backend() === "vercel-blob") {
    try {
      await blobHead(blobKey(sha256));
      return true;
    } catch {
      return false;
    }
  }
  try {
    await fs.access(fsPathFor(sha256));
    return true;
  } catch {
    return false;
  }
}

export async function deleteBundle(sha256: string): Promise<void> {
  assertSha(sha256);
  if (backend() === "vercel-blob") {
    try {
      await blobDel(blobKey(sha256));
    } catch {
      // ignore
    }
    return;
  }
  try {
    await fs.unlink(fsPathFor(sha256));
  } catch {
    // ignore
  }
}

export const BLOB_ROOT = blobRoot;
