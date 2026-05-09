/**
 * Runtime-agnostic types every OXP component runtime must satisfy.
 *
 * The actual instantiation backend (wasmtime, browser WebAssembly + jco,
 * etc.) plugs in via `HostRuntime`. Hosts only ever talk to this
 * interface — they never import wasmtime directly.
 *
 * Lifecycle:
 *   1. Host: `runtime.instantiate(componentBytes, { manifest, broker })`
 *   2. Host: `instance.activate(context)`
 *   3. (component runs, calling broker methods)
 *   4. Host: `instance.deactivate()` then `instance.dispose()`
 *
 * The broker is the ONLY surface the component reaches the host through.
 * Every method on it is permission-gated against `manifest.permissions`.
 */

import type { CapabilityBroker } from "./capabilities.js";

export type RuntimeErrorCode =
  | "INSTANTIATE_FAILED"
  | "INVALID_COMPONENT"
  | "MISSING_EXPORT"
  | "ACTIVATE_FAILED"
  | "DEACTIVATE_FAILED"
  | "ALREADY_DISPOSED"
  | "PERMISSION_DENIED"
  | "UNSUPPORTED_BACKEND"
  | "CAPABILITY_NOT_READY"
  | "INVOCATION_TIMEOUT"
  | "FUEL_EXHAUSTED"
  | "MEMORY_LIMIT_EXCEEDED";

export class RuntimeError extends Error {
  constructor(
    message: string,
    public code: RuntimeErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

/**
 * Activation context handed to the component's `activate` export.
 * Mirrors the `oxp:extension/lifecycle.activate-ctx` WIT record.
 */
export interface ActivationContext {
  /** Manifest id, e.g. "@aldgar/first-extension". */
  extensionId: string;
  /** SemVer string from the manifest. */
  version: string;
  /** Resolved permissions the user actually granted (may be ⊆ requested). */
  grantedPermissions: readonly string[];
  /** Opaque host token the component echoes in subsequent broker calls. */
  hostToken: string;
  /**
   * Identifier the host self-reports to the component (e.g. "vscode",
   * "piye", "test"). Defaults to "host" if the host adapter omits it.
   */
  host?: string;
  /** SemVer-ish version string for the host. Defaults to "0.1.0". */
  hostVersion?: string;
}

/**
 * Minimal manifest slice the runtime needs. Hosts pass the full manifest
 * but the runtime only reads these fields.
 */
export interface RuntimeManifestSlice {
  id: string;
  version: string;
  /** Declared permissions — the broker enforces this set. */
  permissions?: readonly string[];
}

export interface InstantiateOptions {
  manifest: RuntimeManifestSlice;
  broker: CapabilityBroker;
  /**
   * Optional resource limits (Phase A.12 / A.13). Backends that cannot
   * enforce a given dimension (e.g. jco for `maxMemoryMb`) treat it as a
   * hint and may log a warning. Undefined fields fall back to the
   * runtime's documented defaults (`RUNTIME_LIMIT_DEFAULTS` from
   * `@oxprotocol/types`).
   */
  limits?: {
    /** Wall-clock cap (ms) per host→component call. Default 100. */
    timeMsPerCall?: number;
    /** Linear-memory cap (MiB) per instance. Default 64. */
    maxMemoryMb?: number;
    /** Reserved for the wasmtime backend. */
    fuel?: number;
  };
}

/**
 * A live, instantiated extension. Holds all runtime resources until
 * `dispose()` is called; hosts MUST dispose to release native wasmtime
 * stores even if `deactivate()` threw.
 */
export interface ExtensionInstance {
  readonly extensionId: string;
  readonly version: string;

  /** Call the component's `activate` export. Idempotent. */
  activate(ctx: ActivationContext): Promise<void>;

  /** Call the component's `deactivate` export. Idempotent. */
  deactivate(): Promise<void>;

  /**
   * Invoke an exported command handler by id.
   * Returns the JSON-coerced result the component produced.
   */
  invokeCommand(commandId: string, args: unknown): Promise<unknown>;

  /** Free all native resources. Safe to call multiple times. */
  dispose(): Promise<void>;
}

/**
 * The plug-in point every host depends on. Backends:
 *   - `nullBackend()`             — rejects instantiation; useful for tests
 *   - `wasmtimeBackend()`         — week 5+, native via @bytecodealliance
 *   - `jcoBrowserBackend()`       — week 7, browser/webview path
 */
export interface HostRuntime {
  readonly name: string;
  instantiate(
    componentBytes: Uint8Array,
    opts: InstantiateOptions,
  ): Promise<ExtensionInstance>;
}
