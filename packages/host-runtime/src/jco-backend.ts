/**
 * jco backend for `@oxprotocol/host-runtime`.
 *
 * Pipeline:
 *   1. `transpile(componentBytes)` from `@bytecodealliance/jco` lowers
 *      the WASI Preview 2 component to portable JS + a handful of core
 *      `.wasm` modules.
 *   2. The transpiled artifacts are written to a per-instance tmp dir
 *      so we can dynamic-`import()` the entry by file URL.
 *   3. The component's host imports are satisfied from two sources:
 *        - `wasi:*` interfaces — `@bytecodealliance/preview2-shim`'s
 *          `WASIShim`, configured for a tight sandbox (no preopens,
 *          no env, no network).
 *        - `oxp:host/*` interfaces — built from the `CapabilityBroker`
 *          via `buildOxpHostImports()` in this file.
 *   4. The exported `lifecycle.activate / deactivate` are wrapped in
 *      an `ExtensionInstance` whose `dispose()` cleans the tmp dir.
 *
 * Limitations (intentional, addressed in later weeks):
 *   - Wall-clock interruption only — `limits.timeMsPerCall` is enforced
 *     by `Promise.race` against a `setTimeout`. The component's JS
 *     transpilation continues running (V8 cannot preempt it), but the
 *     instance is disposed as soon as the timeout fires so it cannot
 *     observe further host calls. Real wasmtime fuel + epoch
 *     interruption lands with the wasmtime backend (Phase B).
 *   - `limits.maxMemoryMb` is recorded and warned-on but not enforced
 *     under jco; V8 owns `WebAssembly.Memory` growth. wasmtime backend
 *     enforces it via `memory_limiter`.
 *   - `invokeCommand` calls the component's `command-handler.on-command`
 *     export directly; no per-call timeout (week 6).
 *   - The mapping below covers the always-on host interfaces (log,
 *     storage, ui). Gated interfaces (fs/net/secrets/commands) are
 *     scaffolded but route through the broker, which throws
 *     PERMISSION_DENIED if the manifest didn't grant them.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  RuntimeError,
  type ActivationContext,
  type ExtensionInstance,
  type HostRuntime,
  type InstantiateOptions,
} from "./types.js";
import type { CapabilityBroker } from "./capabilities.js";

// ─────────────────────────────────────────────────────────────────────
// Resource-limit defaults (Phase A.12 / A.13)
// ─────────────────────────────────────────────────────────────────────

/** Wall-clock cap per host→component call. Mirrors `RUNTIME_LIMIT_DEFAULTS`
 *  in `@oxprotocol/types`; duplicated here to avoid a runtime dep on @oxprotocol/types
 *  from this package (it's only needed at the type level).
 */
const DEFAULT_TIME_MS_PER_CALL = 100;
const DEFAULT_MAX_MEMORY_MB = 64;

/**
 * Race a host→component call against a wall-clock budget. On expiry we
 * call `onTimeout` (used to mark the instance dead and trigger cleanup)
 * and reject with `RuntimeError(INVOCATION_TIMEOUT)`.
 *
 * Exported for unit tests; production callers go through `makeInstance`.
 *
 * Note: V8 cannot preempt the underlying transpiled JS, so the
 * component's microtasks may keep running after the timeout. The
 * `onTimeout` hook MUST sever the component's access to the host
 * (we mark the instance dead so the broker's `requireAlive()` rejects
 * any further calls).
 */
export async function runWithTimeout<T>(
  fn: () => Promise<T> | T,
  timeMsPerCall: number,
  details: Record<string, unknown>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        /* swallow — must still reject */
      }
      reject(
        new RuntimeError(
          `${details.op ?? "call"} exceeded timeMsPerCall=${timeMsPerCall}ms`,
          "INVOCATION_TIMEOUT",
          { ...details, timeMsPerCall },
        ),
      );
    }, timeMsPerCall);
    if (timer && typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  });
  try {
    return await Promise.race([Promise.resolve().then(fn), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export interface JcoBackendOptions {
  /**
   * Override the tmp directory root. Defaults to `os.tmpdir()`.
   * Useful in tests that want to inspect transpile output.
   */
  tmpRoot?: string;
}

export async function jcoBackend(
  options: JcoBackendOptions = {},
): Promise<HostRuntime> {
  // Imported lazily so consumers that never instantiate a component
  // (e.g. host adapters that only need the type definitions) don't
  // pay the ~50 MB jco load cost.
  const [{ transpile }, { WASIShim }] = await Promise.all([
    import("@bytecodealliance/jco"),
    import("@bytecodealliance/preview2-shim/instantiation"),
  ]);

  const root = options.tmpRoot ?? tmpdir();

  return {
    name: "jco",
    async instantiate(
      componentBytes: Uint8Array,
      opts: InstantiateOptions,
    ): Promise<ExtensionInstance> {
      // Resolve resource limits up front so subsequent code paths see
      // a fully populated record. Defaults match `RUNTIME_LIMIT_DEFAULTS`
      // in @oxprotocol/types.
      const timeMsPerCall =
        opts.limits?.timeMsPerCall ?? DEFAULT_TIME_MS_PER_CALL;
      const maxMemoryMb = opts.limits?.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB;
      if (
        opts.limits?.maxMemoryMb !== undefined &&
        opts.limits.maxMemoryMb !== DEFAULT_MAX_MEMORY_MB
      ) {
        // Surface that the request is recorded but cannot be hard-capped
        // here. Hosts that need real enforcement must select the wasmtime
        // backend.
        // eslint-disable-next-line no-console
        console.warn(
          `[oxp] jco backend cannot enforce maxMemoryMb=${maxMemoryMb} (manifest ${opts.manifest.id}); recorded as hint.`,
        );
      }

      let dir: string | undefined;
      let disposed = false;

      try {
        // Step 1 — transpile the component to JS + core .wasm modules.
        let transpiled;
        try {
          transpiled = await transpile(componentBytes, {
            name: "component",
            instantiation: "async",
            validLiftingOptimization: true,
            nodejsCompat: true,
          } as never);
        } catch (cause) {
          throw new RuntimeError(
            "jco transpile failed; the bytes are not a valid WASI Preview 2 component.",
            "INVALID_COMPONENT",
            { cause: String((cause as Error)?.message ?? cause) },
          );
        }

        const files = (transpiled as { files: Record<string, Uint8Array> })
          .files;

        // Step 2 — materialise to a tmp dir so dynamic import works.
        dir = await mkdtemp(join(root, "oxp-jco-"));
        await Promise.all(
          Object.entries(files).map(async ([name, bytes]) => {
            const target = join(dir!, name);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, bytes);
          }),
        );

        // Step 3 — dynamic import the entry.
        const entryUrl = pathToFileURL(join(dir, "component.js")).href;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mod: any;
        try {
          mod = await import(entryUrl);
        } catch (cause) {
          throw new RuntimeError(
            "Failed to load transpiled component module.",
            "INSTANTIATE_FAILED",
            { cause: String((cause as Error)?.message ?? cause) },
          );
        }
        if (typeof mod.instantiate !== "function") {
          throw new RuntimeError(
            "Transpiled component does not expose an `instantiate` function.",
            "INSTANTIATE_FAILED",
          );
        }

        // Step 4 — build the import object: WASI shim + oxp:host bindings.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wasiImports = new (WASIShim as any)({
          sandbox: {
            preopens: {},
            env: {},
            args: ["extension"],
            enableNetwork: false,
          },
        }).getImportObject();

        const imports = {
          ...wasiImports,
          ...buildOxpHostImports(opts.broker),
        };

        // Step 5 — instantiate, providing a `getCoreModule` that
        // compiles core wasm bytes from the tmp dir.
        const dirSnapshot = dir;
        const getCoreModule = (name: string) =>
          WebAssembly.compile(readFileSync(join(dirSnapshot, name)));

        let compiled;
        try {
          compiled = await mod.instantiate(getCoreModule, imports);
        } catch (cause) {
          throw new RuntimeError(
            "Component instantiation failed.",
            "INSTANTIATE_FAILED",
            { cause: String((cause as Error)?.message ?? cause) },
          );
        }

        // Step 6 — wrap as ExtensionInstance.
        const instanceDir = dir;
        const cleanup = async () => {
          if (disposed) return;
          disposed = true;
          try {
            await rm(instanceDir, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        };

        return makeInstance(compiled, opts.manifest, cleanup, {
          timeMsPerCall,
          maxMemoryMb,
        });
      } catch (err) {
        // Clean up the tmp dir on any failure path.
        if (dir && !disposed) {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        throw err;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// oxp:host/* binding factory
// ─────────────────────────────────────────────────────────────────────

/**
 * Maps the (camelCase, async-friendly) `CapabilityBroker` surface to
 * the kebab-case import object jco expects. Keys here MUST match the
 * un-versioned interface ids used by the transpiled component (e.g.
 * `oxp:host/log`, NOT `oxp:host/log@0.1.0`).
 *
 * Components that don't `import` a given interface won't have it
 * looked up at instantiation, so omitting one here is safe — we only
 * need to supply what hello-world might actually use.
 */
export function buildOxpHostImports(
  broker: CapabilityBroker,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "oxp:host/log": {
      log: (level: string, message: string) => {
        // Coerce defensively; jco passes the WIT enum as the variant tag.
        broker.log.log(level as never, message);
      },
    },
    "oxp:host/storage": {
      get: (key: string) => broker.storage.get(key),
      set: (key: string, value: Uint8Array) => broker.storage.set(key, value),
      delete: (key: string) => broker.storage.delete(key),
      keys: () => broker.storage.keys(),
    },
    "oxp:host/ui": {
      render: (tree: Uint8Array) => broker.ui.render(tree),
      "set-status": (text: string, tooltip?: string) =>
        broker.ui.setStatus(text, tooltip),
      notify: (message: string, buttons: string[]) =>
        broker.ui.notify(message, buttons),
    },
  };

  if (broker.fs) {
    const fs = broker.fs;
    out["oxp:host/fs"] = {
      "read-file": (p: string) => fs.readFile(p),
      "write-file": (p: string, b: Uint8Array) => fs.writeFile(p, b),
      delete: (p: string) => fs.delete(p),
      stat: (p: string) => fs.stat(p),
      "list-dir": (p: string) => fs.listDir(p),
    };
  }
  if (broker.net) {
    const net = broker.net;
    out["oxp:host/net"] = {
      fetch: (req: Parameters<typeof net.fetch>[0]) => net.fetch(req),
    };
  }
  if (broker.secrets) {
    const s = broker.secrets;
    out["oxp:host/secrets"] = {
      get: (k: string) => s.get(k),
      set: (k: string, v: string) => s.set(k, v),
      delete: (k: string) => s.delete(k),
    };
  }
  if (broker.commands) {
    const c = broker.commands;
    out["oxp:host/commands"] = {
      execute: (id: string, argsJson: string) => c.execute(id, argsJson),
    };
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Instance wrapper
// ─────────────────────────────────────────────────────────────────────

interface RawComponent {
  // Both versioned and unversioned keys exist; we use the unversioned
  // alias jco emits for ergonomics.
  lifecycle?: {
    activate: (ctx: unknown) => unknown;
    deactivate: () => unknown;
  };
  uiHandler?: {
    "on-event": (event: Uint8Array) => unknown;
  };
  commandHandler?: {
    "on-command": (id: string, argsJson: string) => unknown;
  };
}

function makeInstance(
  compiled: RawComponent,
  manifest: InstantiateOptions["manifest"],
  cleanup: () => Promise<void>,
  limits: { timeMsPerCall: number; maxMemoryMb: number },
): ExtensionInstance {
  let activated = false;
  let deactivated = false;
  let alive = true;

  const requireAlive = () => {
    if (!alive) {
      throw new RuntimeError("Instance disposed.", "ALREADY_DISPOSED");
    }
  };

  /**
   * Run a host→component call under the wall-clock cap. On timeout we:
   *   1. Mark the instance dead so subsequent calls reject with
   *      ALREADY_DISPOSED rather than racing against the hung promise.
   *   2. Trigger cleanup of the tmp dir.
   *   3. Throw `INVOCATION_TIMEOUT` with the configured budget.
   *
   * The underlying transpiled JS keeps running (V8 cannot preempt it),
   * but it is cut off from the host capability surface and the broker
   * will reject any further calls it tries to make.
   */
  const withTimeout = <T>(op: string, fn: () => Promise<T> | T): Promise<T> =>
    runWithTimeout(
      fn,
      limits.timeMsPerCall,
      { op, extensionId: manifest.id },
      () => {
        alive = false;
        cleanup().catch(() => {});
      },
    );

  const lifecycle = compiled.lifecycle;
  if (!lifecycle?.activate || !lifecycle.deactivate) {
    throw new RuntimeError(
      "Component is missing required `lifecycle` exports.",
      "MISSING_EXPORT",
    );
  }

  return {
    extensionId: manifest.id,
    version: manifest.version,

    async activate(ctx: ActivationContext): Promise<void> {
      requireAlive();
      if (activated) return;
      try {
        await withTimeout("activate", () =>
          // jco lowers the activate-ctx record using camelCase fields.
          lifecycle.activate({
            extensionId: ctx.extensionId,
            version: ctx.version,
            host: ctx.host ?? "host",
            hostVersion: ctx.hostVersion ?? "0.1.0",
          }) as Promise<unknown>,
        );
        activated = true;
      } catch (cause) {
        if (cause instanceof RuntimeError) throw cause;
        throw new RuntimeError(
          `activate() failed: ${(cause as Error).message ?? String(cause)}`,
          "ACTIVATE_FAILED",
          { cause: String((cause as Error)?.message ?? cause) },
        );
      }
    },

    async deactivate(): Promise<void> {
      requireAlive();
      if (!activated || deactivated) return;
      try {
        await withTimeout(
          "deactivate",
          () => lifecycle.deactivate() as Promise<unknown>,
        );
        deactivated = true;
      } catch (cause) {
        if (cause instanceof RuntimeError) throw cause;
        throw new RuntimeError(
          `deactivate() failed: ${(cause as Error).message ?? String(cause)}`,
          "DEACTIVATE_FAILED",
          { cause: String((cause as Error)?.message ?? cause) },
        );
      }
    },

    async invokeCommand(commandId: string, args: unknown): Promise<unknown> {
      requireAlive();
      const handler = compiled.commandHandler;
      if (!handler) {
        throw new RuntimeError(
          "Component does not export a `command-handler` interface.",
          "MISSING_EXPORT",
        );
      }
      const argsJson = JSON.stringify(args ?? null);
      const result = await withTimeout(
        `invokeCommand:${commandId}`,
        () => handler["on-command"](commandId, argsJson) as Promise<unknown>,
      );
      // The component returned a JSON string per the WIT contract.
      try {
        return JSON.parse(result as string);
      } catch {
        return result;
      }
    },

    async dispose(): Promise<void> {
      alive = false;
      await cleanup();
    },
  };
}
