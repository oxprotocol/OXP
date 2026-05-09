/**
 * Null backend — rejects every instantiation with UNSUPPORTED_BACKEND.
 *
 * Useful for:
 *   - host adapter tests that need a HostRuntime instance but never
 *     actually load a component
 *   - week 4 — the contract is wired end-to-end before any real
 *     wasmtime/jco backend exists
 *
 * Real backends (`wasmtimeBackend` in week 5+) implement the same
 * `HostRuntime` interface.
 */

import {
  RuntimeError,
  type ExtensionInstance,
  type HostRuntime,
  type InstantiateOptions,
} from "./types.js";

export function nullBackend(): HostRuntime {
  return {
    name: "null",
    async instantiate(
      _bytes: Uint8Array,
      _opts: InstantiateOptions,
    ): Promise<ExtensionInstance> {
      throw new RuntimeError(
        "The null host-runtime backend cannot instantiate components. " +
          "Wire a real backend (wasmtime, jco) before loading extensions.",
        "UNSUPPORTED_BACKEND",
        { backend: "null" },
      );
    },
  };
}
