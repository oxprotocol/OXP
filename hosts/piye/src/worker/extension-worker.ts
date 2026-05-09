/**
 * @oxprotocol/host-piye/worker — runs INSIDE the per-extension Worker.
 *
 * This is the only @oxprotocol/host-piye module that uses Worker globals.
 * Extension authors do NOT import this directly — it's the entry point
 * the Piye Worker is constructed with. Extension code talks to the
 * `host` API exported here.
 *
 * Lifecycle:
 *   1. Worker spawns, loads this script.
 *   2. Receives BootMessage with manifest + files + entry.
 *   3. Loads the entry file from the in-memory bundle (no disk access).
 *   4. Executes it in the Worker scope, passing `host` as the API surface.
 *   5. Extension calls host.render(...) / host.capability(...) etc.
 */

import type {
  BootMessage,
  CapabilityName,
  CapabilityResponse,
  HostToWorker,
  WorkerToHost,
} from "../protocol.js";

declare const self: DedicatedWorkerGlobalScope & typeof globalThis;

interface PendingCapability {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const pending = new Map<string, PendingCapability>();
let nextId = 1;

function send(msg: WorkerToHost): void {
  self.postMessage(msg);
}

function callCapability(
  capability: CapabilityName,
  args: unknown,
): Promise<unknown> {
  const id = `c${nextId++}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ kind: "capability", id, capability, args });
  });
}

/**
 * The API extensions see. Stable surface — keep this minimal.
 * Extra capabilities go through host.capability(name, args).
 */
export interface HostApi {
  manifest: BootMessage["manifest"];
  files: Map<string, Uint8Array>;

  /** Replace the rendered HTML for this extension's surface. */
  renderHtml(html: string): void;

  /** Hand a serialised @oxprotocol/ui component tree to the host compositor. */
  renderTree(tree: unknown): void;

  /** Invoke a capability. Will reject if not permitted by manifest.permissions. */
  capability(name: CapabilityName, args?: unknown): Promise<unknown>;

  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: unknown,
  ): void;
}

function makeHost(boot: BootMessage): HostApi {
  const files = new Map<string, Uint8Array>(Object.entries(boot.files));
  return {
    manifest: boot.manifest,
    files,
    renderHtml(html) {
      send({ kind: "render", payload: { type: "html", html } });
    },
    renderTree(tree) {
      send({ kind: "render", payload: { type: "ui-tree", tree } });
    },
    capability(name, args) {
      return callCapability(name, args);
    },
    log(level, message, data) {
      send({ kind: "log", level, message, data });
    },
  };
}

/**
 * Run the extension's entry file. We only support JS/TS-evaluated entries
 * compiled to a single string in V1. HTML-only extensions skip the entry
 * and the host renders main.ui directly via the renderHtml message that
 * the bootstrap below emits.
 */
function runEntry(boot: BootMessage, host: HostApi): void {
  const entryBytes = host.files.get(boot.entry);
  if (!entryBytes) {
    // HTML-only extension: render main.ui as the initial payload.
    if (boot.manifest.main?.ui) {
      const ui = host.files.get(boot.manifest.main.ui);
      if (ui) {
        host.renderHtml(new TextDecoder().decode(ui));
        return;
      }
    }
    host.log("warn", `entry ${boot.entry} not found in bundle`);
    return;
  }

  const code = new TextDecoder().decode(entryBytes);
  // Worker-scoped eval. The Worker IS the sandbox boundary; this is the
  // intentional execution point for untrusted extension code.
  // eslint-disable-next-line no-new-func
  const fn = new Function("host", `${code}\n//# sourceURL=${boot.manifest.id}`);
  try {
    fn(host);
  } catch (err) {
    host.log("error", `entry threw: ${(err as Error).message}`);
  }
}

self.addEventListener("message", (e: MessageEvent<HostToWorker>) => {
  const msg = e.data;
  switch (msg.kind) {
    case "boot": {
      const host = makeHost(msg);
      runEntry(msg, host);
      return;
    }
    case "capability:result": {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error ?? "capability failed"));
      return;
    }
    case "event": {
      // Forward as a custom Worker event extensions can listen on.
      self.dispatchEvent(
        new MessageEvent(`oxp:${msg.topic}`, { data: msg.payload }),
      );
      return;
    }
    case "shutdown": {
      // Give extensions a chance to clean up via an event before the
      // host calls terminate().
      self.dispatchEvent(new Event("oxp:shutdown"));
      return;
    }
  }
});

// Allow tests / hosts to introspect.
export const __workerInternal = { pending };
