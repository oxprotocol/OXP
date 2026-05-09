/**
 * @oxprotocol/wit — WIT contract package for the OXP Component Model runtime.
 *
 * This package is the source of truth for the WASI Preview 2 worlds
 * the OXP host implements (`oxp:host@0.1.0`) and the world extension
 * components target (`oxp:extension@0.1.0`).
 *
 * Consumers:
 *   - `@oxprotocol/host-runtime` links these worlds when instantiating a
 *     wasmtime component.
 *   - `@oxprotocol/bundle` (Phase A.11) verifies that a bundle's wit/world.wit
 *     is byte-equivalent (under canonical form) to the version the
 *     manifest pins.
 *   - Language SDKs (Pillar 7) generate bindings from these files.
 *
 * Version pinning (Phase A.11):
 *   The manifest declares `wit: { package, version, sha256 }`. The
 *   registry rejects a publish whose pinned sha256 does not match the
 *   canonical hash of the in-tree .wit for that version. Hosts refuse
 *   to instantiate components whose pinned version they do not ship.
 */

export * from "./version.js";
export * from "./canonical.js";
export * from "./files.js";
