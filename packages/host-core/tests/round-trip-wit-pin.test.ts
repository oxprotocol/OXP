/**
 * E2E round-trip — proves the WASM-pivot wire format flows end-to-end
 * for a `component-v1` bundle:
 *
 *   1. Synthesize a project on disk with a manifest declaring `kind` +
 *      `wit` (the pin built from this build's @oxprotocol/wit).
 *   2. Pack it via @oxprotocol/bundle (assertWitPin runs).
 *   3. Unpack the resulting .oxp bytes from a Buffer (no registry, no HTTP).
 *   4. Re-run the SERVER pin check (`assertWitPin` from @oxprotocol/bundle) on
 *      the unpacked manifest — proves the field survives tar+zstd.
 *   5. Re-run the HOST pin check (`assertHostWitPin` from this package)
 *      on the same manifest — proves the install boundary accepts it.
 *
 * Plus negative cases: pin tampering and oversize bundle.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import {
  packBundle,
  unpackBundle,
  assertWitPin,
  buildExtensionPin,
  WitPinError,
  BUNDLE_LIMITS,
} from "@oxprotocol/bundle";
import {
  worldSha256,
  OXP_EXTENSION_PACKAGE,
  OXP_EXTENSION_VERSION,
} from "@oxprotocol/wit";
import { assertHostWitPin } from "../src/wit-pin.js";
import { VerifyError } from "../src/types.js";

const WORK_PREFIX = join(tmpdir(), "oxp-roundtrip-wit-");

async function makeProject(
  manifest: Record<string, unknown>,
  extra: Array<[string, Buffer | string]> = [],
): Promise<string> {
  const dir = await mkdtemp(WORK_PREFIX);
  await writeFile(
    join(dir, "oxp.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  for (const [path, contents] of extra) {
    const full = join(dir, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents);
  }
  return dir;
}

const baseManifest = {
  $schema: "https://oxp.sh/spec/v1/manifest.schema.json",
  specVersion: "1",
  id: "@aldgar/round-trip",
  publisher: "aldgar",
  version: "0.0.2",
  displayName: "Round-trip Fixture",
  description: "E2E round-trip test for the WASM-pivot wire format.",
  license: "MIT",
  engines: { oxp: "^1.0.0" },
  permissions: [],
  main: { wasm: "ext.wasm" },
  kind: "component-v1" as const,
};

describe("E2E round-trip — component-v1 with wit pin", () => {
  let oxpBytes: Buffer;
  let unpackedManifest: Record<string, unknown>;

  beforeAll(async () => {
    const pin = buildExtensionPin();
    const dir = await makeProject({ ...baseManifest, wit: pin }, [
      [
        "ext.wasm",
        Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      ],
    ]);
    try {
      const { oxp } = await packBundle(dir, {});
      oxpBytes = oxp;

      // Unpack from the in-memory .oxp bytes (no disk path) — same
      // entrypoint a host install would use.
      const dest = await mkdtemp(WORK_PREFIX);
      const { manifest } = await unpackBundle(oxpBytes, dest);
      unpackedManifest = manifest as unknown as Record<string, unknown>;
      await rm(dest, { recursive: true, force: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pack produced a non-empty .oxp", () => {
    expect(oxpBytes.byteLength).toBeGreaterThan(0);
  });

  it("the unpacked manifest preserves kind and wit", () => {
    expect(unpackedManifest.kind).toBe("component-v1");
    expect(unpackedManifest.wit).toEqual({
      package: OXP_EXTENSION_PACKAGE,
      version: OXP_EXTENSION_VERSION,
      sha256: worldSha256(),
    });
  });

  it("server-side assertWitPin accepts the round-tripped manifest", () => {
    expect(() => assertWitPin(unpackedManifest as never)).not.toThrow();
  });

  it("host-side assertHostWitPin accepts the round-tripped manifest", () => {
    expect(() => assertHostWitPin(unpackedManifest as never)).not.toThrow();
  });
});

describe("E2E round-trip — pin tampering is rejected", () => {
  it("flipping one byte of wit.sha256 fails both server and host checks", async () => {
    const pin = buildExtensionPin();
    const dir = await makeProject({ ...baseManifest, wit: pin }, [
      [
        "ext.wasm",
        Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      ],
    ]);
    let tamperedManifest: Record<string, unknown>;
    try {
      const { oxp } = await packBundle(dir, {});

      // Decompress, edit the manifest in the tar stream, repack would be
      // overkill — we already know the manifest survives unpack from the
      // earlier suite. Simulate a malicious mirror by mutating the parsed
      // manifest and rerunning the checks (same code path the registry
      // and host execute on whatever JSON they actually receive).
      const dest = await mkdtemp(WORK_PREFIX);
      const { manifest } = await unpackBundle(oxp, dest);
      tamperedManifest = manifest as unknown as Record<string, unknown>;
      await rm(dest, { recursive: true, force: true });

      const tamperedSha =
        // flip the leading hex digit
        (pin.sha256[0] === "0" ? "1" : "0") + pin.sha256.slice(1);
      tamperedManifest.wit = { ...pin, sha256: tamperedSha };

      try {
        assertWitPin(tamperedManifest as never);
        throw new Error("server check should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(WitPinError);
        expect((e as WitPinError).code).toBe("WIT_PIN_HASH_MISMATCH");
      }

      try {
        assertHostWitPin(tamperedManifest as never);
        throw new Error("host check should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(VerifyError);
        expect((e as VerifyError).code).toBe("WIT_PIN_HASH_MISMATCH");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("E2E round-trip — Pillar 8.3 compressed size cap", () => {
  it("oxp pack rejects bundles larger than BUNDLE_LIMITS.compressedBytes", async () => {
    // Build a payload that does not compress meaningfully (random bytes)
    // and is just over the cap. zstd of random data is ~= identity, so
    // (cap + 256 KiB) of random bytes guarantees we exceed the cap.
    const oversized = Buffer.alloc(BUNDLE_LIMITS.compressedBytes + 256 * 1024);
    for (let i = 0; i < oversized.byteLength; i++) {
      oversized[i] = (Math.random() * 256) | 0;
    }

    // ui-v1 fixture so the policy / pin checks don't intercept first.
    const dir = await makeProject(
      {
        $schema: "https://oxp.sh/spec/v1/manifest.schema.json",
        specVersion: "1",
        id: "@aldgar/oversized",
        publisher: "aldgar",
        version: "0.0.1",
        displayName: "Oversized Fixture",
        license: "MIT",
        engines: { oxp: "^1.0.0" },
        permissions: [],
        main: { ui: "tree.json" },
        ui: { components: "oxp-ui-v1" },
      },
      [
        ["tree.json", JSON.stringify({ kind: "box", children: [] })],
        ["payload.bin", oversized],
      ],
    );
    try {
      await expect(packBundle(dir, {})).rejects.toThrow(/compressed size cap/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
