/**
 * Phase A.7 — Trust-On-First-Use (TOFU) publisher key pinning.
 *
 * TA.4 in the Phase A test plan: install @a/x v1 signed by K1, then publish
 * v2 of the same publisher signed by K2. Host MUST refuse the upgrade with
 * `KEY_PINNING_VIOLATION` and leave the on-disk install of v1 intact.
 *
 * The Store enforces this in `enforcePinning()` BEFORE any disk writes, so
 * the test also verifies no v2 directory was created.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Store,
  VerifyError,
  type HostFs,
  type VerifiedBundle,
} from "../src/index.js";
import { worldSha256 } from "@oxprotocol/wit";

function nodeFs(): HostFs {
  return {
    async exists(p) {
      try {
        await fs.stat(p);
        return true;
      } catch {
        return false;
      }
    },
    async mkdirp(p) {
      await fs.mkdir(p, { recursive: true });
    },
    async readFile(p) {
      return await fs.readFile(p);
    },
    async writeFile(p, bytes) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, bytes);
    },
    async rm(p) {
      await fs.rm(p, { recursive: true, force: true });
    },
    join(...segments) {
      return path.join(...segments);
    },
  };
}

function buildVerified(opts: {
  publisher: string;
  slug: string;
  version: string;
  keyId: string;
}): VerifiedBundle {
  const id = `@${opts.publisher}/${opts.slug}`;
  const manifest = {
    id,
    publisher: opts.publisher,
    version: opts.version,
    displayName: opts.slug,
    description: "tofu fixture",
    kind: "component-v1" as const,
    main: { wasm: "ext.wasm" },
    permissions: [],
    wit: {
      package: "oxp:extension" as const,
      version: "0.1.0" as const,
      sha256: worldSha256(),
    },
  };
  // Minimal valid-looking wasm preamble (magic + version) — Store doesn't
  // re-parse it, the bytes only need to round-trip to disk.
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  return {
    id,
    version: opts.version,
    publisher: opts.publisher,
    slug: opts.slug,
    manifest,
    files: new Map<string, Uint8Array>([
      ["oxp.json", Buffer.from(JSON.stringify(manifest), "utf8")],
      ["ext.wasm", wasm],
    ]),
    tarSha256: "0".repeat(64),
    keyId: opts.keyId,
  };
}

describe("Store — A.7 TOFU key pinning (TA.4)", () => {
  let root: string;
  let store: Store;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "oxp-tofu-"));
    store = new Store(nodeFs(), root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("pins the publisher's signing key on first install", async () => {
    const v1 = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      keyId: "ed25519:K1",
    });
    await store.install(v1);
    const trust = await store.readTrust();
    expect(trust).toHaveLength(1);
    expect(trust[0]).toMatchObject({
      publisher: "alice",
      keyId: "ed25519:K1",
      viaExtensionId: "@alice/tool",
    });
  });

  it("accepts an upgrade signed by the SAME pinned key", async () => {
    await store.install(
      buildVerified({
        publisher: "alice",
        slug: "tool",
        version: "0.1.0",
        keyId: "ed25519:K1",
      }),
    );
    await store.install(
      buildVerified({
        publisher: "alice",
        slug: "tool",
        version: "0.2.0",
        keyId: "ed25519:K1",
      }),
    );
    const installed = await store.get("@alice/tool");
    expect(installed?.version).toBe("0.2.0");
  });

  it("REFUSES an upgrade signed by a DIFFERENT key (KEY_PINNING_VIOLATION)", async () => {
    await store.install(
      buildVerified({
        publisher: "alice",
        slug: "tool",
        version: "0.1.0",
        keyId: "ed25519:K1",
      }),
    );

    const v2WrongKey = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.2.0",
      keyId: "ed25519:K2",
    });

    await expect(store.install(v2WrongKey)).rejects.toMatchObject({
      code: "KEY_PINNING_VIOLATION",
    });

    // Pin must still point at the original key.
    const trust = await store.readTrust();
    expect(trust[0].keyId).toBe("ed25519:K1");

    // v1 install on disk must be unaffected by the failed v2 attempt.
    const installed = await store.get("@alice/tool");
    expect(installed?.version).toBe("0.1.0");
    expect(installed?.keyId).toBe("ed25519:K1");

    // No v2 directory should exist (enforcePinning fails before mkdirp).
    const v2Dir = path.join(root, "extensions", "alice", "tool", "0.2.0");
    expect(
      await fs
        .stat(v2Dir)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it("pins each publisher independently", async () => {
    await store.install(
      buildVerified({
        publisher: "alice",
        slug: "tool",
        version: "0.1.0",
        keyId: "ed25519:KA",
      }),
    );
    // Bob's first install with a totally different key — must succeed
    // because TOFU is per-publisher, not global.
    await store.install(
      buildVerified({
        publisher: "bob",
        slug: "thing",
        version: "0.1.0",
        keyId: "ed25519:KB",
      }),
    );
    const trust = await store.readTrust();
    expect(trust.map((p) => `${p.publisher}=${p.keyId}`).sort()).toEqual([
      "alice=ed25519:KA",
      "bob=ed25519:KB",
    ]);
  });

  it("error message names both keys + the override path", async () => {
    await store.install(
      buildVerified({
        publisher: "alice",
        slug: "tool",
        version: "0.1.0",
        keyId: "ed25519:K1",
      }),
    );
    try {
      await store.install(
        buildVerified({
          publisher: "alice",
          slug: "tool",
          version: "0.2.0",
          keyId: "ed25519:K2",
        }),
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      const msg = (e as VerifyError).message;
      expect(msg).toContain("ed25519:K1");
      expect(msg).toContain("ed25519:K2");
      expect(msg).toContain("trust.json");
    }
  });
});
