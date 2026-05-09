import {
  resolveAndVerify,
  Store,
  Grants,
  finishInstallWithConsent,
  denyAllPrompt,
  type InstalledRecord,
  type PermissionPromptFn,
  type VerifiedBundle,
} from "@oxprotocol/host-core";
import type {
  CapabilityName,
  CapabilityRequest,
  CapabilityResponse,
  HostToWorker,
  WorkerToHost,
} from "./protocol.js";

/**
 * Capability handler. Returns the value to send back to the Worker.
 * Throw to send an error response instead.
 */
export type CapabilityHandler = (args: unknown) => Promise<unknown> | unknown;

/**
 * Per-extension Worker-like handle. Piye supplies a real Worker (or a
 * Realms/iframe shim in tests). host-piye does not depend on the DOM
 * Worker constructor directly so the same code runs in unit tests.
 */
export interface ExtensionWorker {
  postMessage(msg: HostToWorker, transfer?: Transferable[]): void;
  onMessage(handler: (msg: WorkerToHost) => void): void;
  terminate(): void;
}

/**
 * Renderer surface where the extension's UI is mounted.
 * For HTML extensions, host-piye writes html into `shadowRoot.innerHTML`.
 * For @oxprotocol/ui extensions (Pillar 4), host-piye hands the tree to the
 * compositor via the same root.
 */
export interface MountSurface {
  shadowRoot: ShadowRoot;
  /** Called when the extension explicitly requests a re-render. */
  onTreeUpdate?: (tree: unknown) => void;
}

export interface MountOptions {
  /**
   * Factory for the per-extension Worker. PIYE-IDE supplies this. The
   * Worker code MUST import @oxprotocol/host-piye/worker as its entry.
   */
  workerFactory: () => ExtensionWorker;

  /** The DOM surface the extension renders into. */
  surface: MountSurface;

  /**
   * Capability handlers, keyed by capability name. host-piye consults the
   * extension's manifest.permissions before dispatching. A handler missing
   * for a permitted capability is treated as an error.
   */
  capabilities: Partial<Record<CapabilityName, CapabilityHandler>>;
}

/**
 * A live, mounted extension instance. Returned by mount() so PIYE-IDE
 * can later unmount/dispose it.
 */
export interface MountedExtension {
  record: InstalledRecord;
  /**
   * Forward a host-emitted event into the extension Worker. The Worker
   * dispatches it as `oxp:${topic}` on its global scope so extension code
   * can `addEventListener("oxp:command:foo", …)`.
   */
  sendEvent(topic: string, payload?: unknown): void;
  unmount(): Promise<void>;
}

/**
 * Resolve permission requirement for a capability name.
 * `network:api.example.com` is permitted by `network:api.example.com` OR
 * `network:*` OR exact match. Everything else is exact-match only.
 */
function isPermitted(
  capability: CapabilityName,
  permissions: readonly string[],
): boolean {
  if (permissions.includes(capability)) return true;
  if (capability.startsWith("network:")) {
    return permissions.includes("network:*");
  }
  return false;
}

/**
 * Mount a previously-installed extension into a Piye surface.
 * Spawns a Worker, sends the bundle as a BootMessage, wires capabilities,
 * and forwards render payloads to the Shadow DOM.
 */
export async function mount(
  store: Store,
  record: InstalledRecord,
  bundleFiles: Map<string, Uint8Array>,
  opts: MountOptions,
): Promise<MountedExtension> {
  const worker = opts.workerFactory();
  const permissions = record.manifest.permissions ?? [];

  const dispatchCapability = async (
    req: CapabilityRequest,
  ): Promise<CapabilityResponse> => {
    if (!isPermitted(req.capability, permissions)) {
      return {
        kind: "capability:result",
        id: req.id,
        ok: false,
        error: `permission denied: ${req.capability}`,
      };
    }
    const handler = opts.capabilities[req.capability];
    if (!handler) {
      return {
        kind: "capability:result",
        id: req.id,
        ok: false,
        error: `no handler for capability ${req.capability}`,
      };
    }
    try {
      const value = await handler(req.args);
      return { kind: "capability:result", id: req.id, ok: true, value };
    } catch (err) {
      return {
        kind: "capability:result",
        id: req.id,
        ok: false,
        error: (err as Error).message,
      };
    }
  };

  worker.onMessage(async (msg) => {
    switch (msg.kind) {
      case "capability": {
        const response = await dispatchCapability(msg);
        worker.postMessage(response);
        return;
      }
      case "render": {
        if (msg.payload.type === "html") {
          opts.surface.shadowRoot.innerHTML = msg.payload.html;
        } else {
          opts.surface.onTreeUpdate?.(msg.payload.tree);
        }
        return;
      }
      case "log": {
        // Hosts may pipe these to a debug pane. Default: console.
        const fn =
          msg.level === "error"
            ? console.error
            : msg.level === "warn"
              ? console.warn
              : console.log;
        fn(`[${record.id}]`, msg.message, msg.data ?? "");
        return;
      }
    }
  });

  const filesObj: Record<string, Uint8Array> = {};
  for (const [k, v] of bundleFiles) filesObj[k] = v;

  worker.postMessage({
    kind: "boot",
    manifest: record.manifest,
    files: filesObj,
    entry:
      record.manifest.main?.entry ?? record.manifest.main?.ui ?? "oxp.json",
  });

  return {
    record,
    sendEvent(topic, payload) {
      worker.postMessage({ kind: "event", topic, payload });
    },
    async unmount() {
      worker.postMessage({ kind: "shutdown" });
      worker.terminate();
    },
  };
}

/**
 * One-shot install convenience: resolve+verify+consent+install+mount.
 * Most hosts will split these so they can show progress UI per phase.
 *
 * Phase A.4 — `prompt` is required at the call site (or fails closed
 * via `denyAllPrompt`). Pass a Piye-flavoured prompt that renders the
 * permission list inside the embedding page.
 */
export async function installAndMount(
  registry: string,
  id: string,
  store: Store,
  grants: Grants,
  opts: MountOptions & { prompt?: PermissionPromptFn },
): Promise<MountedExtension> {
  const verified: VerifiedBundle = await resolveAndVerify(registry, id);
  const { record } = await finishInstallWithConsent(
    verified,
    store,
    grants,
    opts.prompt ?? denyAllPrompt,
  );
  return mount(store, record, verified.files, opts);
}
