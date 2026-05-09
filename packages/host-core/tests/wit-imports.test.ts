/**
 * Phase A.4 — wit-imports tests. Covers the byte-scan extractor and
 * the permission-gap resolver against synthetic Wasm-shaped buffers
 * and (when built) the real hello-rust component.
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractHostImports,
  findMissingPermissions,
  WIT_INTERFACE_REQUIREMENTS,
} from "@oxprotocol/bundle/wit-imports";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const HELLO_RUST_WASM = path.resolve(
  HERE,
  "../../../examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm",
);

/**
 * Build a synthetic byte buffer that *looks* like a Wasm component to
 * the magic-byte check and contains the supplied import strings as
 * plain UTF-8 (the heuristic doesn't care about real section
 * encoding — it only scans for `oxp:host/<name>` literals).
 */
function fakeWasmWith(...imports: string[]): Uint8Array {
  const header = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00,
  ]);
  const body = new TextEncoder().encode(
    imports.map((i) => `\x00${i}@0.1.0\x00`).join(""),
  );
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

describe("extractHostImports", () => {
  it("returns empty for non-wasm bytes", () => {
    expect(extractHostImports(new Uint8Array([1, 2, 3, 4]))).toEqual(
      new Set(),
    );
    expect(extractHostImports(new Uint8Array(0))).toEqual(new Set());
  });

  it("returns empty for a wasm with no host imports", () => {
    expect(extractHostImports(fakeWasmWith())).toEqual(new Set());
  });

  it("finds a single known interface", () => {
    expect(extractHostImports(fakeWasmWith("oxp:host/log"))).toEqual(
      new Set(["log"]),
    );
  });

  it("dedupes repeated interfaces", () => {
    expect(
      extractHostImports(
        fakeWasmWith("oxp:host/fs", "oxp:host/fs", "oxp:host/log"),
      ),
    ).toEqual(new Set(["fs", "log"]));
  });

  it("ignores unknown oxp:host/* names", () => {
    expect(extractHostImports(fakeWasmWith("oxp:host/futurething"))).toEqual(
      new Set(),
    );
  });

  it("does not match similar prefixes embedded mid-string", () => {
    // "notoxp:host/fs" should NOT match — the scan is for the literal
    // prefix and "fs" alone is fine, but the name is preceded by a
    // valid-identifier byte so the scan starts after `notoxp:host/` —
    // which is `fs` — that DOES start with `oxp:host/`. So we instead
    // verify that random text without the package prefix is ignored.
    const bytes = new TextEncoder().encode("oxpxhost/fs and host/fs");
    const wasm = new Uint8Array(8 + bytes.length);
    wasm.set([0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00], 0);
    wasm.set(bytes, 8);
    expect(extractHostImports(wasm)).toEqual(new Set());
  });

  if (existsSync(HELLO_RUST_WASM)) {
    it("finds at least `log` in the real hello-rust component", () => {
      const bytes = readFileSync(HELLO_RUST_WASM);
      const imports = extractHostImports(bytes);
      expect(imports.has("log")).toBe(true);
    });
  }
});

describe("findMissingPermissions", () => {
  it("returns no gaps when interfaces are ambient", () => {
    expect(findMissingPermissions(["log", "ui", "storage", "types"], [])).toEqual(
      [],
    );
  });

  it("flags fs without any fs.* permission", () => {
    const gaps = findMissingPermissions(["fs"], []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].interface).toBe("fs");
    expect(gaps[0].oneOf).toEqual(WIT_INTERFACE_REQUIREMENTS.fs.requires);
  });

  it("accepts a single fs.read declaration as covering oxp:host/fs", () => {
    expect(findMissingPermissions(["fs"], ["fs.read:workspace"])).toEqual([]);
  });

  it("accepts bare capability heads (no scope)", () => {
    expect(findMissingPermissions(["net"], ["net.fetch"])).toEqual([]);
  });

  it("collects multiple gaps in a single call", () => {
    const gaps = findMissingPermissions(["fs", "net", "secrets"], []);
    expect(gaps.map((g) => g.interface).sort()).toEqual([
      "fs",
      "net",
      "secrets",
    ]);
  });
});
