/**
 * RuntimeManager — installs the bridge between an `InstalledRecord`
 * (produced by `Store.install`) and a live `ExtensionInstance` from
 * `@oxprotocol/host-runtime`.
 *
 * Responsibilities:
 *   - Lazily initialise the underlying `HostRuntime` (jco backend by
 *     default; tests / alternative hosts inject their own).
 *   - Read the bundle's `.wasm` bytes from the host fs.
 *   - Construct a permission-gated `CapabilityBroker` from the
 *     host-supplied `HostCapabilityProvider`.
 *   - Track active instances by extension id; deactivate / dispose
 *     are idempotent and safe to call from a host's `deactivate()`
 *     hook with `disposeAll()`.
 *
 * This class deliberately knows nothing about VS Code, Piye, the file
 * URI scheme, or how the host implements log/storage/ui. Those plug
 * in via `HostCapabilityProvider`.
 */

import type {
  ExtensionInstance,
  HostRuntime,
  HostCapabilityProvider,
  ActivationContext,
} from "@oxprotocol/host-runtime";
import { buildBroker } from "@oxprotocol/host-runtime";
import {
  RUNTIME_LIMIT_DEFAULTS,
  RUNTIME_LIMIT_MAX,
  type RuntimeLimits,
} from "@oxprotocol/types";
import { randomBytes } from "node:crypto";

import type { HostFs } from "./fs.js";
import type { InstalledRecord } from "./types.js";
import { VerifyError } from "./types.js";
import { kindOf } from "./wit-pin.js";
import type { Store } from "./store.js";

/**
 * Strategy for sourcing the host-side capability provider for a given
 * installed record. Lets hosts attach per-extension scopes (storage
 * key prefix, fs roots, etc.) without RuntimeManager caring.
 */
export type ProviderFactory = (
  record: InstalledRecord,
) => HostCapabilityProvider;

export interface RuntimeManagerOptions {
  /**
   * Lazy factory for the backend. Called once on first activation.
   * Use `() => jcoBackend()` in production hosts.
   */
  runtime: () => Promise<HostRuntime>;
  /** Filesystem the `Store` was constructed with. */
  fs: HostFs;
  /** Installed-extension index. Used to resolve the on-disk path. */
  store: Store;
  providerFactory: ProviderFactory;
  /**
   * Identifier the host self-reports in `ActivationContext.host`.
   * E.g. "vscode", "piye". Defaults to "host".
   */
  hostName?: string;
  /** SemVer for `ActivationContext.hostVersion`. Defaults to "0.1.0". */
  hostVersion?: string;
}

interface ActiveEntry {
  instance: ExtensionInstance;
  /** Provider held strongly so log streams etc. survive until dispose. */
  provider: HostCapabilityProvider;
}

export class RuntimeManager {
  private runtime: HostRuntime | undefined;
  private readonly active = new Map<string, ActiveEntry>();

  constructor(private readonly opts: RuntimeManagerOptions) {}

  /** True iff `id` has been activated and not yet deactivated/disposed. */
  isActive(id: string): boolean {
    return this.active.has(id);
  }

  /** All currently active extension ids. */
  activeIds(): string[] {
    return [...this.active.keys()];
  }

  /**
   * Instantiate and activate a record's component. Throws `VerifyError`
   * when the record is `ui-v1` (no .wasm to run) or has no
   * `manifest.main.wasm`. Idempotent: re-activating an already-active
   * extension returns the existing instance.
   */
  async activate(record: InstalledRecord): Promise<ExtensionInstance> {
    const existing = this.active.get(record.id);
    if (existing) return existing.instance;

    const kind = kindOf(record.manifest);
    if (kind === "ui-v1") {
      throw new VerifyError(
        `${record.id} is a ui-v1 bundle and has no component to activate.`,
        "BAD_MANIFEST",
      );
    }
    const wasmRel = record.manifest.main?.wasm;
    if (!wasmRel) {
      throw new VerifyError(
        `${record.id} declares kind=${kind} but no main.wasm.`,
        "BAD_MANIFEST",
      );
    }

    const runtime = await this.ensureRuntime();
    const root = this.opts.store.resourcePath(record);
    const wasmPath = this.opts.fs.join(root, ...wasmRel.split("/"));
    const bytes = await this.opts.fs.readFile(wasmPath);

    // Phase A.4 — refuse to start a record that was installed without
    // going through the consent flow (legacy bundle from before A.4,
    // or a sideload that bypassed `installWithConsent`). The user must
    // explicitly re-install via the consent path before activation.
    if (record.grantedPermissions === undefined) {
      throw new VerifyError(
        `${record.id} was installed without recording permission grants. ` +
          `Re-install via the consent flow to activate.`,
        "PERMISSIONS_NOT_GRANTED",
      );
    }

    const provider = this.opts.providerFactory(record);
    const manifestSlice = {
      id: record.id,
      version: record.version,
      // Phase A.4 — the broker enforces the user's *granted* set, not
      // whatever the manifest happens to list. A user who customised
      // down (e.g. denied `net.fetch`) gets PERMISSION_DENIED at the
      // broker even though the manifest still requests it.
      permissions: record.grantedPermissions,
    };
    const broker = buildBroker(provider, manifestSlice);
    const limits = resolveLimits(record);

    const instance = await runtime.instantiate(bytes, {
      manifest: manifestSlice,
      broker,
      limits,
    });

    const ctx: ActivationContext = {
      extensionId: record.id,
      version: record.version,
      grantedPermissions: manifestSlice.permissions,
      hostToken: cryptoRandom(),
      host: this.opts.hostName ?? "host",
      hostVersion: this.opts.hostVersion ?? "0.1.0",
    };

    try {
      await instance.activate(ctx);
    } catch (err) {
      // Activation failed — release the wasm store before propagating.
      await instance.dispose().catch(() => {});
      throw err;
    }

    this.active.set(record.id, { instance, provider });
    return instance;
  }

  /**
   * Deactivate + dispose. No-op if not active. Returns true if a live
   * instance was actually torn down.
   */
  async deactivate(id: string): Promise<boolean> {
    const entry = this.active.get(id);
    if (!entry) return false;
    this.active.delete(id);
    try {
      await entry.instance.deactivate();
    } finally {
      await entry.instance.dispose().catch(() => {});
    }
    return true;
  }

  /** Tear down every active instance. Safe to call from host shutdown. */
  async disposeAll(): Promise<void> {
    const ids = [...this.active.keys()];
    await Promise.allSettled(ids.map((id) => this.deactivate(id)));
  }

  private async ensureRuntime(): Promise<HostRuntime> {
    if (!this.runtime) {
      this.runtime = await this.opts.runtime();
    }
    return this.runtime;
  }
}

/**
 * 16 bytes of randomness, hex-encoded — used as the per-activation
 * `hostToken`.
 */
function cryptoRandom(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Resolve the effective resource limits for a record (Phase A.12 / A.13).
 *
 * Manifest values are clamped to `[1, RUNTIME_LIMIT_MAX]` rather than
 * thrown on, because the registry already validated the manifest at
 * publish time. The clamp is purely defence-in-depth in case an
 * extension was installed via a sideload path that bypassed schema
 * validation. Out-of-range values are coerced silently to the maximum.
 */
function resolveLimits(record: InstalledRecord): {
  timeMsPerCall: number;
  maxMemoryMb: number;
} {
  const declared: RuntimeLimits | undefined = (
    record.manifest as { limits?: RuntimeLimits }
  ).limits;

  const clamp = (n: number | undefined, dflt: number, max: number) => {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return dflt;
    return Math.min(Math.floor(n), max);
  };

  return {
    timeMsPerCall: clamp(
      declared?.timeMsPerCall,
      RUNTIME_LIMIT_DEFAULTS.timeMsPerCall,
      RUNTIME_LIMIT_MAX.timeMsPerCall,
    ),
    maxMemoryMb: clamp(
      declared?.maxMemoryMb,
      RUNTIME_LIMIT_DEFAULTS.maxMemoryMb,
      RUNTIME_LIMIT_MAX.maxMemoryMb,
    ),
  };
}
