/**
 * Permission-gating broker.
 *
 * The host implements the *full* set of capabilities (a `HostCapabilityProvider`).
 * `buildBroker(provider, manifest)` returns a `CapabilityBroker` that:
 *
 *   1. Always exposes log/storage/ui (these have no manifest gate).
 *   2. Exposes fs/net/secrets/commands ONLY if the matching permission
 *      string appears in `manifest.permissions`.
 *   3. Wraps every gated method so that even if a backend bug allowed
 *      the import binding to leak through, the call still throws
 *      `RuntimeError("PERMISSION_DENIED")`. Defense-in-depth.
 *
 * Permission strings (kept stable; documented in oxp:host WIT):
 *
 *   fs.read           → fs.{readFile,stat,listDir}
 *   fs.write          → fs.writeFile
 *   fs.delete         → fs.delete
 *   net.fetch         → net.fetch
 *   secrets.read      → secrets.get
 *   secrets.write     → secrets.{set,delete}
 *   commands.executeHost → commands.execute
 *
 * Scope filtering (path prefixes for fs, origin allowlists for net) is
 * the host *provider*'s job — the broker only enforces the coarse
 * permission flag. This keeps the broker pure and lets each host wire
 * its own scope policy.
 */

import type {
  CapabilityBroker,
  CommandsCapability,
  FsCapability,
  NetCapability,
  SecretsCapability,
} from "./capabilities.js";
import { RuntimeError, type RuntimeManifestSlice } from "./types.js";

/**
 * Host-supplied implementation of every capability. Hosts wire real
 * backends (node:fs, fetch, keychain, etc.) here. The broker takes
 * ownership of which subset is exposed.
 */
export interface HostCapabilityProvider {
  log: CapabilityBroker["log"];
  storage: CapabilityBroker["storage"];
  ui: CapabilityBroker["ui"];
  /** Required if any `fs.*` permission may be granted. */
  fs?: FsCapability;
  /** Required if `net.fetch` may be granted. */
  net?: NetCapability;
  /** Required if any `secrets.*` permission may be granted. */
  secrets?: SecretsCapability;
  /** Required if `commands.executeHost` may be granted. */
  commands?: CommandsCapability;
}

/** Permission strings recognised by the broker (for autocomplete + tests). */
export const PERMISSIONS = {
  FS_READ: "fs.read",
  FS_WRITE: "fs.write",
  FS_DELETE: "fs.delete",
  NET_FETCH: "net.fetch",
  SECRETS_READ: "secrets.read",
  SECRETS_WRITE: "secrets.write",
  COMMANDS_EXECUTE_HOST: "commands.executeHost",
} as const;

const denyError = (op: string) =>
  new RuntimeError(
    `Capability "${op}" is not granted for this extension.`,
    "PERMISSION_DENIED",
    { op },
  );

/** Returns a rejected Promise so async-typed wrappers stay async. */
const deny = <T>(op: string): Promise<T> => Promise.reject(denyError(op));

/** Return a brand-new broker whose surface matches the granted permissions. */
export function buildBroker(
  provider: HostCapabilityProvider,
  manifest: RuntimeManifestSlice,
): CapabilityBroker {
  const granted = new Set(manifest.permissions ?? []);
  const has = (p: string) => granted.has(p);

  const broker: {
    -readonly [K in keyof CapabilityBroker]: CapabilityBroker[K];
  } = {
    log: provider.log,
    storage: provider.storage,
    ui: provider.ui,
  };

  if (
    has(PERMISSIONS.FS_READ) ||
    has(PERMISSIONS.FS_WRITE) ||
    has(PERMISSIONS.FS_DELETE)
  ) {
    if (!provider.fs) {
      throw new RuntimeError(
        "Manifest declares an fs.* permission but the host did not register an fs provider.",
        "PERMISSION_DENIED",
        { provider: "fs" },
      );
    }
    const fs = provider.fs;
    broker.fs = {
      readFile: (p) =>
        has(PERMISSIONS.FS_READ) ? fs.readFile(p) : deny("fs.readFile"),
      stat: (p) => (has(PERMISSIONS.FS_READ) ? fs.stat(p) : deny("fs.stat")),
      listDir: (p) =>
        has(PERMISSIONS.FS_READ) ? fs.listDir(p) : deny("fs.listDir"),
      writeFile: (p, b) =>
        has(PERMISSIONS.FS_WRITE) ? fs.writeFile(p, b) : deny("fs.writeFile"),
      delete: (p) =>
        has(PERMISSIONS.FS_DELETE) ? fs.delete(p) : deny("fs.delete"),
    };
  }

  if (has(PERMISSIONS.NET_FETCH)) {
    if (!provider.net) {
      throw new RuntimeError(
        "Manifest declares net.fetch but the host did not register a net provider.",
        "PERMISSION_DENIED",
        { provider: "net" },
      );
    }
    broker.net = provider.net;
  }

  if (has(PERMISSIONS.SECRETS_READ) || has(PERMISSIONS.SECRETS_WRITE)) {
    if (!provider.secrets) {
      throw new RuntimeError(
        "Manifest declares a secrets.* permission but the host did not register a secrets provider.",
        "PERMISSION_DENIED",
        { provider: "secrets" },
      );
    }
    const s = provider.secrets;
    broker.secrets = {
      get: (k) =>
        has(PERMISSIONS.SECRETS_READ) ? s.get(k) : deny("secrets.get"),
      set: (k, v) =>
        has(PERMISSIONS.SECRETS_WRITE) ? s.set(k, v) : deny("secrets.set"),
      delete: (k) =>
        has(PERMISSIONS.SECRETS_WRITE) ? s.delete(k) : deny("secrets.delete"),
    };
  }

  if (has(PERMISSIONS.COMMANDS_EXECUTE_HOST)) {
    if (!provider.commands) {
      throw new RuntimeError(
        "Manifest declares commands.executeHost but the host did not register a commands provider.",
        "PERMISSION_DENIED",
        { provider: "commands" },
      );
    }
    broker.commands = provider.commands;
  }

  return broker as CapabilityBroker;
}
