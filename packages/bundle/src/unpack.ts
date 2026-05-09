import { promises as fs } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { decompress } from "@mongodb-js/zstd";
import * as tar from "tar-stream";
import { assertManifest } from "@oxprotocol/schema";
import type { OxpManifest } from "@oxprotocol/types";
import { BUNDLE_LIMITS, PATH_PATTERN } from "./limits.js";

export interface UnpackResult {
  manifest: OxpManifest;
  /** Files that were written, with POSIX-relative paths. */
  files: string[];
}

/**
 * Unpack an `.oxp` archive (zstd-compressed tar) into `destDir`.
 *
 * Hardening (Phase B.3):
 *   - Reject path-traversal (`..`) entries via post-resolve check.
 *   - Reject symlinks / hardlinks loudly (do NOT silently skip).
 *   - Cap file count and total uncompressed size during streaming so a
 *     zip-bomb tar can't exhaust disk before we notice.
 *   - Cap per-file size during streaming.
 */
export async function unpackBundle(
  oxp: Buffer,
  destDir: string,
): Promise<UnpackResult> {
  const tarBytes = Buffer.from(await decompress(oxp));
  const extract = tar.extract();

  await fs.mkdir(destDir, { recursive: true });
  const absRoot = resolve(destDir);
  const written: string[] = [];
  let manifestRaw: string | null = null;
  let totalBytes = 0;

  await new Promise<void>((resolveP, rejectP) => {
    extract.on("entry", (header, stream, next) => {
      (async () => {
        const name = header.name;
        // Hard-reject link types: even if our extractor would skip them,
        // a downstream unpacker (host install, virus scanner, mirror)
        // might follow the link and read off-tree files.
        if (
          header.type === "symlink" ||
          header.type === "link" ||
          header.type === "block-device" ||
          header.type === "character-device" ||
          header.type === "fifo"
        ) {
          rejectP(
            new Error(
              `unpackBundle: bundle contains forbidden entry type '${header.type}': ${name}`,
            ),
          );
          stream.resume();
          return;
        }
        if (header.type !== "file") {
          // Directories etc — skip silently; we mkdir as needed.
          stream.resume();
          next();
          return;
        }
        if (!PATH_PATTERN.test(name)) {
          rejectP(new Error(`unpackBundle: invalid entry path: ${name}`));
          stream.resume();
          return;
        }
        const target = resolve(absRoot, name);
        if (
          !target.startsWith(
            absRoot + (process.platform === "win32" ? "\\" : "/"),
          ) &&
          target !== absRoot
        ) {
          rejectP(new Error(`unpackBundle: path escapes destination: ${name}`));
          stream.resume();
          return;
        }
        if (written.length >= BUNDLE_LIMITS.fileCount) {
          rejectP(
            new Error(
              `unpackBundle: bundle exceeds file count cap (${BUNDLE_LIMITS.fileCount})`,
            ),
          );
          stream.resume();
          return;
        }
        await fs.mkdir(dirname(target), { recursive: true });
        const chunks: Buffer[] = [];
        let entryBytes = 0;
        for await (const c of stream as AsyncIterable<Buffer>) {
          entryBytes += c.length;
          totalBytes += c.length;
          if (entryBytes > BUNDLE_LIMITS.fileBytes) {
            throw new Error(
              `unpackBundle: file '${name}' exceeds per-file size cap (${BUNDLE_LIMITS.fileBytes} bytes)`,
            );
          }
          if (totalBytes > BUNDLE_LIMITS.totalBytes) {
            throw new Error(
              `unpackBundle: bundle exceeds uncompressed size cap (${BUNDLE_LIMITS.totalBytes} bytes) — possible zip bomb`,
            );
          }
          chunks.push(c);
        }
        const buf = Buffer.concat(chunks);
        if (name === "oxp.json") manifestRaw = buf.toString("utf8");
        await fs.writeFile(target, buf, { mode: 0o644 });
        written.push(name);
        next();
      })().catch(rejectP);
    });
    extract.on("finish", () => resolveP());
    extract.on("error", rejectP);
    extract.end(tarBytes);
  });

  if (!manifestRaw) {
    throw new Error("unpackBundle: bundle does not contain oxp.json");
  }
  const manifest = assertManifest(JSON.parse(manifestRaw));
  return { manifest, files: written };
}

// utility for tests / consumers that want POSIX-style joining without importing path/posix
export const joinPosix = (...parts: string[]): string => posix.join(...parts);
export const joinNative = (...parts: string[]): string => join(...parts);
