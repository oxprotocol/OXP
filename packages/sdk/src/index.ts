import type { UiTree } from "@oxprotocol/types";

export type { UiTree } from "@oxprotocol/types";

/**
 * Capability names available to extensions in V1.
 * Mirrors hosts/piye/src/protocol.ts — kept here so authors don't depend
 * on a host package.
 */
export type CapabilityName =
  | "read-clipboard"
  | "write-clipboard"
  | "storage:local"
  | `network:${string}`;

/**
 * The runtime API the host injects into your extension as `host`.
 *
 * In Piye Workers, this is the global `host` provided by the worker entry.
 * In VS Code webviews, this is wired through window.acquireOxpApi() (Pillar
 * 2 dev shim — see hosts/vscode/src/dev-bridge.ts).
 * In `oxp dev`, this is a hot-reloading mock backed by your local machine.
 */
export interface HostApi {
  manifest: OxpManifest;
  /** Bundled files keyed by POSIX path. Read-only snapshot. */
  files: ReadonlyMap<string, Uint8Array>;
  renderHtml(html: string): void;
  renderTree(tree: UiTree): void;
  capability(name: CapabilityName, args?: unknown): Promise<unknown>;
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: unknown,
  ): void;
}

/**
 * The shape of oxp.json. Exposed so authors can `satisfies OxpManifest`
 * their manifests in TS toolchains.
 */
export interface OxpManifest {
  specVersion: "1";
  id: string;
  publisher: string;
  version: string;
  displayName: string;
  description?: string;
  permissions?: readonly string[];
  main?: {
    /** HTML entry for HTML extensions. */
    ui?: string;
    /** JS entry for code extensions. Loaded into the Worker. */
    entry?: string;
  };
  ui?: {
    components?: readonly string[];
    preferredSurface?: "panel" | "view" | "editor";
  };
  compat?: {
    hosts?: readonly string[];
  };
  [key: string]: unknown;
}

/**
 * The shape an extension's entry module exports.
 *
 *   export default defineExtension({
 *     async activate(host) { host.renderHtml('<h1>hi</h1>'); }
 *   })
 */
export interface ExtensionDefinition {
  activate(host: HostApi): void | Promise<void>;
  deactivate?(host: HostApi): void | Promise<void>;
}

/**
 * Identity helper. Pure type narrowing — no runtime work.
 * Use this in your entry file so editors get full IntelliSense.
 */
export function defineExtension(def: ExtensionDefinition): ExtensionDefinition {
  return def;
}

/**
 * Convenience: typed wrappers around capability() for the V1 capabilities.
 * Authors can use these instead of stringly-typed host.capability() calls.
 */
export function clipboard(host: HostApi) {
  return {
    read: () => host.capability("read-clipboard") as Promise<string>,
    write: (text: string) =>
      host.capability("write-clipboard", { text }) as Promise<void>,
  };
}

export function storage(host: HostApi) {
  return {
    get: (key: string) =>
      host.capability("storage:local", { op: "get", key }) as Promise<
        unknown | null
      >,
    set: (key: string, value: unknown) =>
      host.capability("storage:local", {
        op: "set",
        key,
        value,
      }) as Promise<void>,
    delete: (key: string) =>
      host.capability("storage:local", { op: "delete", key }) as Promise<void>,
  };
}

/**
 * Typed fetch shim that routes through the network capability so the
 * permission gate sees a real domain.
 *
 *   const data = await net(host).fetch('https://api.example.com/x').then(r=>r.json())
 */
export function net(host: HostApi) {
  return {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      const u = new URL(url);
      const capability = `network:${u.hostname}` as const;
      const result = (await host.capability(capability, {
        url,
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: init?.body,
      })) as {
        status: number;
        headers: Record<string, string>;
        body: string;
      };
      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      });
    },
  };
}
