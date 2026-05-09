/**
 * Raw `.wasm` fetcher for the "Install from URL" flow.
 *
 * Distinct from {@link resolveAndVerify}, which handles signed registry
 * tarballs. This helper is for the lower-trust path where the user pastes
 * a direct URL to a single component file (registry artifact, GitHub
 * release asset, localhost dev server, or `file://` for tests). The
 * caller is responsible for prompting the user for permissions before
 * loading the resulting bytes into the runtime.
 *
 * Supported schemes: `https:`, `http:` (with explicit opt-in), `file:`.
 *
 * The fetched bytes are written to a deterministic cache path under
 * `cacheDir` so subsequent loads of the same URL skip the network.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";

export class FetchBundleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "BAD_URL"
      | "SCHEME_NOT_ALLOWED"
      | "FETCH_FAILED"
      | "TOO_LARGE"
      | "NOT_WASM"
      | "READ_FAILED",
  ) {
    super(message);
    this.name = "FetchBundleError";
  }
}

export interface FetchBundleOptions {
  /** Directory to cache downloaded `.wasm` files in. */
  cacheDir: string;
  /** Allow `http://` (defaults to false; required for localhost demos). */
  allowInsecureHttp?: boolean;
  /** Hard cap, defaults to 64 MiB. */
  maxBytes?: number;
  /** Report download progress (bytes received). */
  onProgress?: (received: number, total: number | null) => void;
  /** Inject a custom fetch (for tests). */
  fetch?: typeof fetch;
  /**
   * What to validate the downloaded bytes as before caching:
   *   "wasm" (default) — reject anything not starting with `\0asm`.
   *   "any"            — skip magic-byte check; caller does its own
   *                      detection (e.g. wasm vs `.oxp` zstd-tar bundle).
   * Cache filename suffix becomes `.bin` instead of `.wasm` when "any".
   */
  accept?: "wasm" | "any";
}

export interface FetchedBundle {
  /** Absolute path to the cached `.wasm`. */
  componentPath: string;
  /** SHA-256 of the bytes, hex. */
  sha256: string;
  /** Length in bytes. */
  size: number;
  /** Original URL (normalized). */
  sourceUrl: string;
}

const DEFAULT_MAX = 64 * 1024 * 1024;
const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]); // "\0asm"

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWasm(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== WASM_MAGIC[i]) return false;
  return true;
}

/**
 * Download (or read from `file://`) a `.wasm` component, validate its
 * magic bytes, and cache it under `cacheDir/<sha256>.wasm`.
 */
export async function fetchBundle(
  rawUrl: string,
  opts: FetchBundleOptions,
): Promise<FetchedBundle> {
  let url: NodeURL;
  try {
    url = new NodeURL(rawUrl);
  } catch {
    throw new FetchBundleError(`not a valid URL: ${rawUrl}`, "BAD_URL");
  }

  const max = opts.maxBytes ?? DEFAULT_MAX;
  let bytes: Uint8Array;

  if (url.protocol === "file:") {
    try {
      const local = fileURLToPath(url);
      const st = await stat(local);
      if (st.size > max) {
        throw new FetchBundleError(
          `file too large: ${st.size} > ${max}`,
          "TOO_LARGE",
        );
      }
      bytes = new Uint8Array(await readFile(local));
      opts.onProgress?.(bytes.length, bytes.length);
    } catch (e) {
      if (e instanceof FetchBundleError) throw e;
      throw new FetchBundleError(
        `read ${rawUrl}: ${(e as Error).message}`,
        "READ_FAILED",
      );
    }
  } else if (
    url.protocol === "https:" ||
    (url.protocol === "http:" && opts.allowInsecureHttp)
  ) {
    const f = opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(rawUrl);
    } catch (e) {
      throw new FetchBundleError(
        `fetch ${rawUrl}: ${(e as Error).message}`,
        "FETCH_FAILED",
      );
    }
    if (!res.ok) {
      throw new FetchBundleError(
        `fetch ${rawUrl} → HTTP ${res.status}`,
        "FETCH_FAILED",
      );
    }
    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? Number.parseInt(totalHeader, 10) : null;
    if (total !== null && total > max) {
      throw new FetchBundleError(
        `content-length ${total} > ${max}`,
        "TOO_LARGE",
      );
    }

    if (!res.body) {
      bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > max) {
        throw new FetchBundleError(
          `body ${bytes.length} > ${max}`,
          "TOO_LARGE",
        );
      }
      opts.onProgress?.(bytes.length, total);
    } else {
      const chunks: Uint8Array[] = [];
      let received = 0;
      const reader = res.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > max) {
            throw new FetchBundleError(
              `stream exceeded ${max} bytes`,
              "TOO_LARGE",
            );
          }
          chunks.push(value);
          opts.onProgress?.(received, total);
        }
      }
      bytes = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.byteLength;
      }
    }
  } else {
    throw new FetchBundleError(
      `scheme not allowed: ${url.protocol}`,
      "SCHEME_NOT_ALLOWED",
    );
  }

  if (opts.accept !== "any" && !isWasm(bytes)) {
    throw new FetchBundleError(
      `not a wasm component (bad magic): ${rawUrl}`,
      "NOT_WASM",
    );
  }

  const sha = sha256Hex(bytes);
  await mkdir(opts.cacheDir, { recursive: true });
  const ext = opts.accept === "any" ? "bin" : "wasm";
  const componentPath = path.join(opts.cacheDir, `${sha}.${ext}`);
  // Skip rewrite if cache hit.
  let exists = false;
  try {
    const st = await stat(componentPath);
    exists = st.size === bytes.length;
  } catch {
    /* miss */
  }
  if (!exists) {
    await writeFile(componentPath, bytes);
  }

  return {
    componentPath,
    sha256: sha,
    size: bytes.length,
    sourceUrl: url.href,
  };
}
