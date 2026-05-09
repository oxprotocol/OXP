import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packBundle,
  unpackBundle,
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
  digestBundle,
} from "../src/index.js";

let workDir: string;
let srcDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "oxp-bundle-"));
  srcDir = join(workDir, "src");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(srcDir, "oxp.json"),
    JSON.stringify(
      {
        specVersion: "1",
        id: "@acme/hello",
        version: "0.1.0",
        displayName: "Hello",
        publisher: "acme",
        license: "MIT",
        engines: { oxp: "^1.0.0" },
        main: { ui: "ui/index.html" },
      },
      null,
      2,
    ),
  );
  mkdirSync(join(srcDir, "ui"), { recursive: true });
  writeFileSync(
    join(srcDir, "ui", "index.html"),
    "<!doctype html><meta charset=utf-8><title>Hello</title><h1>Hello, OXP.</h1>\n",
  );
});

describe("packBundle / unpackBundle round-trip", () => {
  it("produces deterministic output across two packs of the same input", async () => {
    const a = await packBundle(srcDir, { zstdLevel: 3 });
    const b = await packBundle(srcDir, { zstdLevel: 3 });
    expect(a.bundleSha256).toBe(b.bundleSha256);
    expect(a.tar.equals(b.tar)).toBe(true);
  });

  it("digest equals sha256 of the uncompressed tar", async () => {
    const r = await packBundle(srcDir, { zstdLevel: 3 });
    expect(digestBundle(r.tar)).toBe(r.bundleSha256);
  });

  it("unpacks back to a directory with the same manifest", async () => {
    const r = await packBundle(srcDir, { zstdLevel: 3 });
    const out = join(workDir, "out");
    const u = await unpackBundle(r.oxp, out);
    expect(u.manifest.id).toBe("@acme/hello");
    expect(u.files).toContain("oxp.json");
    expect(u.files).toContain("ui/index.html");
    expect(u.files).toContain(".oxp/integrity.json");
  });
});

describe("Ed25519 sign / verify", () => {
  it("verifies a valid signature and rejects a tampered one", async () => {
    const r = await packBundle(srcDir, { zstdLevel: 3 });
    const kp = generateEd25519KeyPair();
    const sig = signEd25519(r.bundleSha256, kp.privateKeyPem, kp.publicKeyPem);
    expect(verifyEd25519(sig, kp.publicKeyPem)).toBe(true);

    const tampered = {
      ...sig,
      payload: { ...sig.payload, digest: "sha256:" + "f".repeat(64) },
    };
    expect(verifyEd25519(tampered, kp.publicKeyPem)).toBe(false);

    const otherKp = generateEd25519KeyPair();
    expect(verifyEd25519(sig, otherKp.publicKeyPem)).toBe(false);
  });
});
