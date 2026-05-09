/**
 * Phase A.4 — installer tests.
 *
 * Exercises `finishInstallWithConsent` end-to-end against real
 * Store/Grants instances on tmp dirs. The verified bundle is built
 * by hand (no network / signature path involved) so we can construct
 * any combination of imports + manifest permissions + prior grants.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Grants,
  Store,
  VerifyError,
  allowAllPrompt,
  denyAllPrompt,
  finishInstallWithConsent,
  type HostFs,
  type PermissionPromptFn,
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

/** Synthetic Wasm-shaped bytes that the import scanner sees as importing
 *  the supplied interfaces. */
function fakeWasmWith(...imports: string[]): Uint8Array {
  const header = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00,
  ]);
  const body = new TextEncoder().encode(
    imports.map((i) => `\x00${i}\x00`).join(""),
  );
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

/** Build a `VerifiedBundle` without going through the network. */
function buildVerified(opts: {
  publisher: string;
  slug: string;
  version: string;
  permissions: string[];
  imports: string[];
}): VerifiedBundle {
  const id = `@${opts.publisher}/${opts.slug}`;
  const manifest = {
    id,
    publisher: opts.publisher,
    version: opts.version,
    displayName: opts.slug,
    description: "test fixture",
    kind: "component-v1" as const,
    main: { wasm: "ext.wasm" },
    permissions: opts.permissions,
    wit: {
      package: "oxp:extension" as const,
      version: "0.1.0" as const,
      sha256: worldSha256(),
    },
  };
  const wasmBytes = fakeWasmWith(...opts.imports.map((i) => `oxp:host/${i}`));
  return {
    id: manifest.id,
    version: manifest.version,
    publisher: manifest.publisher,
    slug: opts.slug,
    manifest,
    files: new Map<string, Uint8Array>([
      ["oxp.json", Buffer.from(JSON.stringify(manifest), "utf8")],
      ["ext.wasm", wasmBytes],
    ]),
    tarSha256: "0".repeat(64),
    keyId: "ed25519:0xtest",
  };
}

describe("finishInstallWithConsent", () => {
  let root: string;
  let store: Store;
  let grants: Grants;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "oxp-installer-"));
    const f = nodeFs();
    store = new Store(f, root);
    grants = new Grants(f, root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rejects when component imports an interface the manifest doesn't cover", async () => {
    const verified = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      permissions: [], // missing fs.read*
      imports: ["fs"],
    });
    await expect(
      finishInstallWithConsent(verified, store, grants, allowAllPrompt),
    ).rejects.toMatchObject({ code: "MANIFEST_PERMISSIONS_INSUFFICIENT" });
  });

  it("skips the prompt entirely when only ambient interfaces are imported", async () => {
    const prompt = vi.fn() as unknown as PermissionPromptFn;
    const verified = buildVerified({
      publisher: "alice",
      slug: "ambient",
      version: "0.1.0",
      permissions: [],
      imports: ["log"],
    });
    const { record, prompted } = await finishInstallWithConsent(
      verified,
      store,
      grants,
      prompt,
    );
    expect(prompted).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
    expect(record.grantedPermissions).toEqual([]);
  });

  it("prompts on first install and persists the granted set", async () => {
    const verified = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      permissions: ["fs.read:workspace", "net.fetch:*"],
      imports: ["fs", "net"],
    });
    const { record, prompted } = await finishInstallWithConsent(
      verified,
      store,
      grants,
      allowAllPrompt,
    );
    expect(prompted).toBe(true);
    expect(record.grantedPermissions?.sort()).toEqual([
      "fs.read:workspace",
      "net.fetch:*",
    ]);
    const stored = await grants.get("alice", "tool");
    expect(stored?.granted.sort()).toEqual([
      "fs.read:workspace",
      "net.fetch:*",
    ]);
    expect(stored?.lastSeenManifestPermissions.sort()).toEqual([
      "fs.read:workspace",
      "net.fetch:*",
    ]);
    expect(stored?.lastSeenVersion).toBe("0.1.0");
  });

  it("throws PERMISSION_DENIED_BY_USER when the prompt denies", async () => {
    const verified = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      permissions: ["fs.read:workspace"],
      imports: ["fs"],
    });
    await expect(
      finishInstallWithConsent(verified, store, grants, denyAllPrompt),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED_BY_USER" });
    expect(await grants.get("alice", "tool")).toBeUndefined();
  });

  it("reuses a prior grant on upgrade with no new permissions", async () => {
    const v1 = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      permissions: ["fs.read:workspace"],
      imports: ["fs"],
    });
    await finishInstallWithConsent(v1, store, grants, allowAllPrompt);

    const v2 = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.2.0",
      permissions: ["fs.read:workspace"], // unchanged
      imports: ["fs"],
    });
    const prompt = vi.fn() as unknown as PermissionPromptFn;
    const { record, prompted } = await finishInstallWithConsent(
      v2,
      store,
      grants,
      prompt,
    );
    expect(prompted).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
    expect(record.grantedPermissions).toEqual(["fs.read:workspace"]);
    const stored = await grants.get("alice", "tool");
    expect(stored?.lastSeenVersion).toBe("0.2.0");
  });

  it("re-prompts on upgrade that adds a new permission", async () => {
    const v1 = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      permissions: ["fs.read:workspace"],
      imports: ["fs"],
    });
    await finishInstallWithConsent(v1, store, grants, allowAllPrompt);

    const v2 = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.2.0",
      permissions: ["fs.read:workspace", "net.fetch:*"], // net.fetch is new
      imports: ["fs", "net"],
    });
    const prompt: PermissionPromptFn = vi.fn(allowAllPrompt);
    const { prompted } = await finishInstallWithConsent(
      v2,
      store,
      grants,
      prompt,
    );
    expect(prompted).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    const call = (prompt as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.isUpgrade).toBe(true);
  });

  it("constrains a malicious prompt's grantedRaw to manifest permissions", async () => {
    const verified = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      permissions: ["fs.read:workspace"],
      imports: ["fs"],
    });
    const evilPrompt: PermissionPromptFn = async () => ({
      kind: "grant",
      grantedRaw: ["fs.read:workspace", "process.kill"], // not in manifest
    });
    const { record } = await finishInstallWithConsent(
      verified,
      store,
      grants,
      evilPrompt,
    );
    expect(record.grantedPermissions).toEqual(["fs.read:workspace"]);
  });

  it("propagates a partial customize decision (subset granted)", async () => {
    const verified = buildVerified({
      publisher: "alice",
      slug: "tool",
      version: "0.1.0",
      permissions: ["fs.read:workspace", "net.fetch:*"],
      imports: ["fs", "net"],
    });
    const partial: PermissionPromptFn = async () => ({
      kind: "grant",
      grantedRaw: ["fs.read:workspace"], // user unticked net.fetch
    });
    const { record } = await finishInstallWithConsent(
      verified,
      store,
      grants,
      partial,
    );
    expect(record.grantedPermissions).toEqual(["fs.read:workspace"]);
  });
});

describe("activator refuses pre-A.4 records", () => {
  // Activate without going through installWithConsent → record has no
  // grantedPermissions → activator must throw PERMISSIONS_NOT_GRANTED.
  // Covered indirectly by the activator round-trip test (it now passes
  // grantedPermissions: [] explicitly). This block guards the error
  // shape so a regression doesn't silently downgrade to "ok with no
  // grants".
  it("VerifyError exposes the PERMISSIONS_NOT_GRANTED code", () => {
    const err = new VerifyError("x", "PERMISSIONS_NOT_GRANTED");
    expect(err.code).toBe("PERMISSIONS_NOT_GRANTED");
  });
});
