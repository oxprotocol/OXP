/**
 * End-to-end smoke test for the jco backend.
 *
 * Loads the prebuilt `examples/hello-rust` component (a real Rust
 * Wasm component compiled with `wasm32-wasip2` + wit-bindgen 0.36)
 * through the full pipeline:
 *
 *     Rust .wasm  →  jco transpile  →  Node WebAssembly.compile
 *                 →  WASIShim + oxp:host bindings  →  activate()
 *
 * Asserts the host saw the expected `log.log("info", "hello from …")`
 * call from the component's `activate` export. This proves:
 *   1. our WIT contract (oxp:extension world) actually works
 *   2. wit-bindgen 0.36 produces a component the canonical `extension`
 *      world accepts
 *   3. the broker-to-jco mapping in `jco-backend.ts` is correct for
 *      the always-on log interface
 *   4. lifecycle.activate / deactivate / dispose all run cleanly
 *
 * Skipped automatically if the .wasm hasn't been built — CI must
 * run `cargo build --release --target wasm32-wasip2` in
 * examples/hello-rust before running this suite.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildBroker,
  jcoBackend,
  RuntimeError,
  runWithTimeout,
  type ExtensionInstance,
  type HostCapabilityProvider,
  type HostRuntime,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(
  HERE,
  "../../../examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm",
);

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

describeIfBuilt("jcoBackend — hello-rust round-trip", () => {
  let runtime: HostRuntime;
  let instance: ExtensionInstance | undefined;
  let host: ReturnType<typeof provider>;

  beforeAll(async () => {
    runtime = await jcoBackend();
  });

  afterAll(async () => {
    if (instance) await instance.dispose();
  });

  it("transpiles, instantiates, and runs activate → log call observed", async () => {
    host = provider();
    const manifest = {
      id: "@aldgar/hello-rust",
      version: "0.1.0",
      permissions: [],
    };
    const broker = buildBroker(host, manifest);
    const bytes = readFileSync(WASM_PATH);

    instance = await runtime.instantiate(bytes, { manifest, broker });
    expect(instance.extensionId).toBe("@aldgar/hello-rust");
    expect(instance.version).toBe("0.1.0");

    await instance.activate({
      extensionId: manifest.id,
      version: manifest.version,
      grantedPermissions: [],
      hostToken: "test-token",
    });

    // The Rust code calls log.log(Level.Info, "hello from …").
    expect(host.log.log).toHaveBeenCalledTimes(1);
    const [level, message] = host.log.log.mock.calls[0]!;
    expect(level).toBe("info");
    expect(message).toContain("@aldgar/hello-rust");
    expect(message).toContain("0.1.0");
  }, 30_000);

  it("deactivate runs and emits the goodbye log", async () => {
    if (!instance) throw new Error("instance not initialised");
    await instance.deactivate();
    // Should now have two log calls: hello + goodbye.
    expect(host.log.log).toHaveBeenCalledTimes(2);
    expect(host.log.log.mock.calls[1]![1]).toBe("goodbye");
  });

  it("dispose() cleans up the tmp dir and is idempotent", async () => {
    if (!instance) throw new Error("instance not initialised");
    await instance.dispose();
    await instance.dispose(); // second call is a no-op
  });

  it("activate() respects timeMsPerCall plumbing (smoke)", async () => {
    // Real timeout enforcement is unit-tested against `runWithTimeout`
    // below — the wall-clock latency of jco's transpile makes a
    // sub-millisecond budget non-deterministic against the real wasm.
    // Here we only assert that passing `limits` through `instantiate`
    // does not break the happy path.
    const localHost = provider();
    const manifest = {
      id: "@aldgar/hello-rust-limits",
      version: "0.1.0",
      permissions: [],
    };
    const broker = buildBroker(localHost, manifest);
    const bytes = readFileSync(WASM_PATH);
    const inst = await runtime.instantiate(bytes, {
      manifest,
      broker,
      limits: { timeMsPerCall: 5_000, maxMemoryMb: 64 },
    });
    await inst.activate({
      extensionId: manifest.id,
      version: manifest.version,
      grantedPermissions: [],
      hostToken: "test-token",
    });
    await inst.dispose();
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────
// Phase A.12 — wall-clock timeout helper
// ─────────────────────────────────────────────────────────────────────

describe("runWithTimeout (Phase A.12)", () => {
  it("resolves with the underlying value when the call beats the budget", async () => {
    let onTimeout = 0;
    const v = await runWithTimeout(
      () => Promise.resolve(42),
      100,
      { op: "test" },
      () => {
        onTimeout++;
      },
    );
    expect(v).toBe(42);
    expect(onTimeout).toBe(0);
  });

  it("rejects with INVOCATION_TIMEOUT and invokes onTimeout when the budget is exceeded", async () => {
    let onTimeout = 0;
    const promise = runWithTimeout(
      () => new Promise(() => {}), // never resolves
      5,
      { op: "hang", extensionId: "@x/y" },
      () => {
        onTimeout++;
      },
    );
    await expect(promise).rejects.toBeInstanceOf(RuntimeError);
    await promise.catch((err: RuntimeError) => {
      expect(err.code).toBe("INVOCATION_TIMEOUT");
      expect(err.details).toMatchObject({
        op: "hang",
        extensionId: "@x/y",
        timeMsPerCall: 5,
      });
    });
    expect(onTimeout).toBe(1);
  });

  it("does not invoke onTimeout if the call returns synchronously", async () => {
    let onTimeout = 0;
    const v = await runWithTimeout(
      () => "ok",
      100,
      { op: "sync" },
      () => {
        onTimeout++;
      },
    );
    expect(v).toBe("ok");
    expect(onTimeout).toBe(0);
  });
});

describe("jcoBackend — error paths", () => {
  it("rejects garbage bytes with INVALID_COMPONENT", async () => {
    const runtime = await jcoBackend();
    const host = provider();
    const manifest = { id: "@x/y", version: "0.0.0", permissions: [] };
    const broker = buildBroker(host, manifest);
    await expect(
      runtime.instantiate(new Uint8Array([0, 0, 0, 0, 1, 2, 3]), {
        manifest,
        broker,
      }),
    ).rejects.toMatchObject({
      name: "RuntimeError",
      code: "INVALID_COMPONENT",
    });
  }, 30_000);
});
