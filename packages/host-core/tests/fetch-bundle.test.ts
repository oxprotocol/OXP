/**
 * Phase A.5 — `fetchBundle` (Install from URL) tests.
 *
 * Covers the three transports we ship today:
 *   - `file://` (always allowed; used by demo + CI smoke)
 *   - `https://` via injected fetch
 *   - `http://`  refused unless `allowInsecureHttp`
 *
 * Plus the magic-byte sniff and the size cap.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FetchBundleError, fetchBundle } from "../src/fetch-bundle.js";

const WASM_HEADER = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00,
]);
const NOT_WASM = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

let cacheDir: string;
let workDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "oxp-cache-"));
  workDir = await mkdtemp(path.join(tmpdir(), "oxp-src-"));
});
afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
});

function fakeFetch(
  body: Uint8Array,
  status = 200,
  contentLength?: number,
): typeof fetch {
  return (async () => {
    const headers = new Headers();
    if (contentLength !== undefined) {
      headers.set("content-length", String(contentLength));
    }
    return new Response(status === 200 ? body : null, { status, headers });
  }) as unknown as typeof fetch;
}

describe("fetchBundle", () => {
  it("reads file:// URLs", async () => {
    const src = path.join(workDir, "ext.wasm");
    await writeFile(src, WASM_HEADER);
    const r = await fetchBundle(pathToFileURL(src).href, { cacheDir });
    expect(r.size).toBe(WASM_HEADER.length);
    expect(r.componentPath.startsWith(cacheDir)).toBe(true);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("downloads https:// URLs via injected fetch", async () => {
    const r = await fetchBundle("https://example.test/ext.wasm", {
      cacheDir,
      fetch: fakeFetch(WASM_HEADER, 200, WASM_HEADER.length),
    });
    expect(r.size).toBe(WASM_HEADER.length);
  });

  it("refuses http:// without opt-in", async () => {
    await expect(
      fetchBundle("http://example.test/ext.wasm", {
        cacheDir,
        fetch: fakeFetch(WASM_HEADER),
      }),
    ).rejects.toMatchObject({ code: "SCHEME_NOT_ALLOWED" });
  });

  it("allows http:// when allowInsecureHttp=true", async () => {
    const r = await fetchBundle("http://localhost:8000/ext.wasm", {
      cacheDir,
      allowInsecureHttp: true,
      fetch: fakeFetch(WASM_HEADER, 200, WASM_HEADER.length),
    });
    expect(r.size).toBe(WASM_HEADER.length);
  });

  it("rejects non-wasm payloads", async () => {
    await expect(
      fetchBundle("https://example.test/x.wasm", {
        cacheDir,
        fetch: fakeFetch(NOT_WASM, 200, NOT_WASM.length),
      }),
    ).rejects.toMatchObject({ code: "NOT_WASM" });
  });

  it("enforces maxBytes via content-length", async () => {
    await expect(
      fetchBundle("https://example.test/huge.wasm", {
        cacheDir,
        maxBytes: 4,
        fetch: fakeFetch(WASM_HEADER, 200, WASM_HEADER.length),
      }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("propagates HTTP errors", async () => {
    await expect(
      fetchBundle("https://example.test/missing.wasm", {
        cacheDir,
        fetch: fakeFetch(new Uint8Array(), 404),
      }),
    ).rejects.toBeInstanceOf(FetchBundleError);
  });

  it("caches by sha256 (second call reuses path)", async () => {
    const src = path.join(workDir, "ext.wasm");
    await writeFile(src, WASM_HEADER);
    const url = pathToFileURL(src).href;
    const a = await fetchBundle(url, { cacheDir });
    const b = await fetchBundle(url, { cacheDir });
    expect(a.componentPath).toBe(b.componentPath);
    expect(a.sha256).toBe(b.sha256);
  });
});
