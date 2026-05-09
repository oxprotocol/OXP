import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { compress } from "@mongodb-js/zstd";
import * as tar from "tar-stream";
import { assertManifest } from "@oxprotocol/schema";
import type { OxpManifest } from "@oxprotocol/types";
import {
  BUNDLE_LIMITS,
  DETERMINISTIC_MTIME,
  PATH_PATTERN,
  RESERVED_PATHS,
} from "./limits.js";
import { walk, type DiscoveredFile } from "./walk.js";
import { computeIntegrityManifest } from "./integrity.js";
import { assertBundlePolicy } from "./security.js";
import { assertWitPin } from "./wit-pin.js";

export interface PackOptions {
  /** zstd compression level. Spec mandates 19; tests may use lower. */
  zstdLevel?: number;
  /** If true, write `.oxp/integrity.json` (per-file digests). Default true. */
  writeIntegrityManifest?: boolean;
}

export interface PackResult {
  /** The uncompressed deterministic tar stream. */
  tar: Buffer;
  /** The compressed `.oxp` archive bytes. */
  oxp: Buffer;
  /** sha256 of `tar` (lowercase hex, no prefix). */
  bundleSha256: string;
  /** Parsed manifest as packed (verbatim, no integrity stamping). */
  manifest: OxpManifest;
}

/**
 * Pack a directory into an `.oxp` archive.
 *
 * Determinism rules (spec/v1/bundle.md §2):
 *   - POSIX tar (USTAR), mtime 1980-01-01, mode 0644, uid/gid 0
 *   - Entry order: `oxp.json` first, all others lexicographic, then
 *     `.oxp/integrity.json` last (when written)
 *   - zstd compression
 *
 * The manifest is NOT mutated by packing. The bundle digest
 * (sha256 of the uncompressed tar) is returned in the result and is the
 * value placed in the signature payload and the OCI layer descriptor —
 * never stored back into `oxp.json`. This matches Cosign / SLSA, avoids the
 * self-reference paradox, and lets any verifier recompute the digest by
 * simply re-hashing the unpacked tar stream.
 */
export async function packBundle(
  srcDir: string,
  opts: PackOptions = {},
): Promise<PackResult> {
  const { zstdLevel = 19, writeIntegrityManifest = true } = opts;

  // 1. Discover and validate
  const discovered = await walk(srcDir);
  if (discovered.length === 0) {
    throw new Error(`packBundle: directory is empty: ${srcDir}`);
  }

  let totalBytes = 0;
  for (const f of discovered) {
    if (RESERVED_PATHS.has(f.path)) {
      throw new Error(`packBundle: reserved path present in source: ${f.path}`);
    }
    if (!PATH_PATTERN.test(f.path)) {
      throw new Error(`packBundle: invalid path: ${f.path}`);
    }
    if (f.size > BUNDLE_LIMITS.fileBytes) {
      throw new Error(
        `packBundle: file exceeds ${BUNDLE_LIMITS.fileBytes} bytes: ${f.path} (${f.size})`,
      );
    }
    totalBytes += f.size;
  }
  if (discovered.length > BUNDLE_LIMITS.fileCount) {
    throw new Error(
      `packBundle: too many files (${discovered.length} > ${BUNDLE_LIMITS.fileCount})`,
    );
  }
  if (totalBytes > BUNDLE_LIMITS.totalBytes) {
    throw new Error(
      `packBundle: total size ${totalBytes} exceeds ${BUNDLE_LIMITS.totalBytes}`,
    );
  }

  // 2. Locate, parse, and validate manifest
  const manifestEntry = discovered.find((f) => f.path === "oxp.json");
  if (!manifestEntry) {
    throw new Error(`packBundle: oxp.json not found at bundle root`);
  }
  const manifestRaw = await fs.readFile(manifestEntry.abs, "utf8");
  const manifest = assertManifest(JSON.parse(manifestRaw));

  // 2b. Phase A.10 / A.3 — bundle policy (no JS in oxp-ui-v1, known perms).
  //     CLI cannot know if publisher is verified — default false; the
  //     registry re-runs this check with the verified flag set appropriately.
  assertBundlePolicy(
    manifest,
    discovered.map((f) => f.path),
    { publisherVerified: false },
  );

  // 2c. Phase A.11 — WIT contract pin check. Required for component-v1
  //     and hybrid-v1; optional for ui-v1.
  assertWitPin(manifest);

  // 3. Build canonical entry list
  const otherFiles: DiscoveredFile[] = discovered
    .filter((f) => f.path !== "oxp.json")
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const entries: PackEntry[] = [{ path: "oxp.json", abs: manifestEntry.abs }];
  for (const f of otherFiles) entries.push({ path: f.path, abs: f.abs });

  // 4. Per-file integrity manifest, written last so its own digest is excluded
  if (writeIntegrityManifest) {
    const integrity = await computeIntegrityManifest([
      manifestEntry,
      ...otherFiles,
    ]);
    entries.push({
      path: ".oxp/integrity.json",
      bytes: Buffer.from(JSON.stringify(integrity, null, 2) + "\n", "utf8"),
    });
  }

  // 5. Pack and hash
  const tarBytes = await writeDeterministicTar(entries);
  const bundleSha256 = createHash("sha256").update(tarBytes).digest("hex");

  // 6. Compress
  const compressed = await compress(tarBytes, zstdLevel);
  const oxp = Buffer.isBuffer(compressed)
    ? compressed
    : Buffer.from(compressed);

  // 7. Pillar 8.3 — compressed size cap. Authors get a clear, early
  //    failure here instead of a 422 from the registry.
  if (oxp.byteLength > BUNDLE_LIMITS.compressedBytes) {
    throw new Error(
      `bundle exceeds compressed size cap: ${oxp.byteLength} bytes > ${BUNDLE_LIMITS.compressedBytes} (Pillar 8.3 — "the lightest extension ecosystem ever built").`,
    );
  }

  return { tar: tarBytes, oxp, bundleSha256, manifest };
}

// ──────────────────────────────────────────────────────────────────────
// internals
// ──────────────────────────────────────────────────────────────────────

interface PackEntry {
  path: string;
  abs?: string;
  bytes?: Buffer;
}

async function writeDeterministicTar(entries: PackEntry[]): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];

  const collected = new Promise<void>((resolve, reject) => {
    pack.on("data", (c: Buffer) => chunks.push(c));
    pack.on("end", () => resolve());
    pack.on("error", reject);
  });

  for (const entry of entries) {
    const bytes = entry.bytes ?? (await fs.readFile(entry.abs!));
    await new Promise<void>((resolve, reject) => {
      pack.entry(
        {
          name: entry.path,
          size: bytes.length,
          mode: 0o644,
          mtime: DETERMINISTIC_MTIME,
          uid: 0,
          gid: 0,
          uname: "",
          gname: "",
          type: "file",
        },
        bytes,
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
  pack.finalize();
  await collected;
  return Buffer.concat(chunks);
}
