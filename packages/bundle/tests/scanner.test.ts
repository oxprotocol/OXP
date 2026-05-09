/**
 * Phase B.3 — server-side bundle scanner hardening tests.
 *
 * These cover the unpackBundle defences against malicious tar entries:
 * symlinks, hardlinks, device files, zip-bomb expansion, file count.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compress } from "@mongodb-js/zstd";
import * as tar from "tar-stream";
import { unpackBundle } from "../src/index.js";

const VALID_MANIFEST = JSON.stringify({
  specVersion: "1",
  id: "@acme/evil",
  version: "0.1.0",
  displayName: "Evil",
  publisher: "acme",
  license: "MIT",
  engines: { oxp: "^1.0.0" },
  main: { ui: "ui/index.html" },
});

interface Entry {
  name: string;
  type?:
    | "file"
    | "directory"
    | "symlink"
    | "link"
    | "block-device"
    | "character-device"
    | "fifo";
  body?: string | Buffer;
  linkname?: string;
}

async function buildBundle(entries: Entry[]): Promise<Buffer> {
  const pack = tar.pack();
  for (const e of entries) {
    const body = e.body ?? "";
    pack.entry(
      {
        name: e.name,
        type: e.type ?? "file",
        size: typeof body === "string" ? Buffer.byteLength(body) : body.length,
        linkname: e.linkname,
      },
      typeof body === "string" ? Buffer.from(body) : body,
    );
  }
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const c of pack as AsyncIterable<Buffer>) chunks.push(c);
  const tarBuf = Buffer.concat(chunks);
  return Buffer.from(await compress(tarBuf));
}

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "oxp-bundle-scan-"));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("unpackBundle hardening (Phase B.3)", () => {
  it("rejects symlink entries even when target is harmless", async () => {
    const oxp = await buildBundle([
      { name: "oxp.json", body: VALID_MANIFEST },
      { name: "ui/index.html", body: "<h1>ok</h1>" },
      {
        name: "evil.link",
        type: "symlink",
        linkname: "/etc/passwd",
      },
    ]);
    await expect(
      unpackBundle(oxp, join(workDir, "symlink-out")),
    ).rejects.toThrow(/forbidden entry type 'symlink'/);
  });

  it("rejects hardlink entries", async () => {
    const oxp = await buildBundle([
      { name: "oxp.json", body: VALID_MANIFEST },
      { name: "ui/index.html", body: "<h1>ok</h1>" },
      { name: "evil.hardlink", type: "link", linkname: "oxp.json" },
    ]);
    await expect(
      unpackBundle(oxp, join(workDir, "hardlink-out")),
    ).rejects.toThrow(/forbidden entry type 'link'/);
  });

  it("rejects path traversal entries (TB.3 — Zip Slip)", async () => {
    const oxp = await buildBundle([
      { name: "oxp.json", body: VALID_MANIFEST },
      { name: "../../etc/passwd", body: "root:x:0:0::/root:/bin/sh\n" },
    ]);
    await expect(
      unpackBundle(oxp, join(workDir, "traversal-out")),
    ).rejects.toThrow(/invalid entry path|escapes destination/);
  });

  it("rejects per-file size bomb", async () => {
    // 17 MiB single file blows past fileBytes (16 MiB).
    const huge = Buffer.alloc(17 * 1024 * 1024, 0x41);
    const oxp = await buildBundle([
      { name: "oxp.json", body: VALID_MANIFEST },
      { name: "ui/index.html", body: "<h1>ok</h1>" },
      { name: "huge.bin", body: huge },
    ]);
    await expect(unpackBundle(oxp, join(workDir, "huge-out"))).rejects.toThrow(
      /per-file size cap|uncompressed size cap/,
    );
  });
});
