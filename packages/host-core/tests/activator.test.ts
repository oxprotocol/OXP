/**
 * Activator round-trip — proves the install pipeline hands off cleanly
 * to `@oxprotocol/host-runtime`'s jco backend. Loads the prebuilt
 * `examples/hello-rust` component, installs it via `Store` against a
 * real tmp dir + node fs adapter, then activates via `RuntimeManager`
 * and asserts the host saw the expected `log.log` call.
 *
 * Skipped automatically when the component hasn't been built.
 */

import { existsSync, readFileSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  RuntimeManager,
  Store,
  type HostFs,
  type InstalledRecord,
  type VerifiedBundle,
} from "../src/index.js";
import { jcoBackend, type HostCapabilityProvider } from "@oxprotocol/host-runtime";
import { worldSha256 } from "@oxprotocol/wit";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WASM_PATH = path.resolve(
  HERE,
  "../../../examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm",
);

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

const provider = (): HostCapabilityProvider & {
  log: { log: ReturnType<typeof vi.fn> };
} => ({
  log: { log: vi.fn() },
  storage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
  },
  ui: {
    render: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
  },
});

const hasWasm = existsSync(WASM_PATH);
const describeIfBuilt = hasWasm ? describe : describe.skip;

describeIfBuilt("RuntimeManager — install + activate hello-rust", () => {
  let root: string;
  let store: Store;
  let manager: RuntimeManager;
  let providerStub: ReturnType<typeof provider>;
  let installed: InstalledRecord;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "oxp-activator-"));
    const hostFs = nodeFs();
    store = new Store(hostFs, root);

    // Hand-roll a VerifiedBundle around the existing Rust .wasm.
    // We bypass network resolve+verify; the activator only cares
    // about what `Store.install` writes to disk.
    const wasmBytes = readFileSync(WASM_PATH);
    const manifest = {
      specVersion: "1",
      id: "@aldgar/hello-rust",
      publisher: "aldgar",
      version: "0.1.0",
      displayName: "Hello Rust",
      description: "Activator round-trip fixture.",
      kind: "component-v1" as const,
      main: { wasm: "ext.wasm" },
      permissions: [],
      wit: {
        package: "oxp:extension" as const,
        version: "0.1.0" as const,
        sha256: worldSha256(),
      },
    };
    const verified: VerifiedBundle = {
      id: manifest.id,
      version: manifest.version,
      publisher: manifest.publisher,
      slug: "hello-rust",
      manifest,
      files: new Map<string, Uint8Array>([
        ["oxp.json", Buffer.from(JSON.stringify(manifest), "utf8")],
        ["ext.wasm", wasmBytes],
      ]),
      tarSha256: "0".repeat(64),
      keyId: "ed25519:0xtest",
    };
    installed = await store.install(verified, { grantedPermissions: [] });

    providerStub = provider();
    manager = new RuntimeManager({
      runtime: () => jcoBackend(),
      fs: hostFs,
      store,
      providerFactory: () => providerStub,
      hostName: "test",
      hostVersion: "1.2.3",
    });
  });

  afterAll(async () => {
    await manager.disposeAll();
    await rm(root, { recursive: true, force: true });
  });

  it("activate() instantiates and runs the component", async () => {
    const inst = await manager.activate(installed);
    expect(inst.extensionId).toBe("@aldgar/hello-rust");
    expect(manager.isActive(installed.id)).toBe(true);

    // Rust hello-world calls log.log("info", "hello from {ext} v{ver} on host test (1.2.3)").
    expect(providerStub.log.log).toHaveBeenCalledTimes(1);
    const [level, message] = providerStub.log.log.mock.calls[0]!;
    expect(level).toBe("info");
    expect(message).toContain("@aldgar/hello-rust");
    expect(message).toContain("test");
    expect(message).toContain("1.2.3");
  }, 30_000);

  it("activate() is idempotent — second call returns the same instance", async () => {
    const a = await manager.activate(installed);
    const b = await manager.activate(installed);
    expect(b).toBe(a);
    // Still only the original "hello" log; no second activate fired.
    expect(providerStub.log.log).toHaveBeenCalledTimes(1);
  });

  it("deactivate() runs goodbye and clears active state", async () => {
    const torn = await manager.deactivate(installed.id);
    expect(torn).toBe(true);
    expect(manager.isActive(installed.id)).toBe(false);
    expect(providerStub.log.log).toHaveBeenCalledTimes(2);
    expect(providerStub.log.log.mock.calls[1]![1]).toBe("goodbye");
  });

  it("deactivate() on an unknown id returns false", async () => {
    expect(await manager.deactivate("@nobody/nothing")).toBe(false);
  });
});

describe("RuntimeManager — input validation", () => {
  it("refuses to activate a ui-v1 record", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "oxp-activator-"));
    try {
      const hostFs = nodeFs();
      const store = new Store(hostFs, root);
      const manager = new RuntimeManager({
        runtime: () =>
          Promise.reject(new Error("runtime should not be initialised")),
        fs: hostFs,
        store,
        providerFactory: () => provider(),
      });
      const record: InstalledRecord = {
        id: "@x/ui",
        version: "0.0.1",
        publisher: "x",
        slug: "ui",
        installedAt: new Date().toISOString(),
        keyId: "ed25519:0xtest",
        tarSha256: "0".repeat(64),
        manifest: {
          specVersion: "1",
          id: "@x/ui",
          publisher: "x",
          version: "0.0.1",
          displayName: "UI",
          kind: "ui-v1",
          main: { ui: "index.html" },
        },
        files: ["oxp.json", "index.html"],
      };
      await expect(manager.activate(record)).rejects.toMatchObject({
        name: "VerifyError",
        code: "BAD_MANIFEST",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
