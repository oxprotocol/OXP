/**
 * Pinned WIT package versions for OXP spec v1.
 *
 * Bumping either constant is a breaking change to the runtime contract
 * and requires:
 *   1. New `.wit` files committed under packages/wit/wit/ at the new version
 *   2. Manifest schema updated to accept the new pinned version
 *   3. Host runtime updated to link the new world
 *   4. Migration note in ARCHITECTURE-WASM-PIVOT.md and ROADMAP-SECURITY.md
 */

export const OXP_HOST_PACKAGE = "oxp:host" as const;
export const OXP_HOST_VERSION = "0.1.0" as const;

export const OXP_EXTENSION_PACKAGE = "oxp:extension" as const;
export const OXP_EXTENSION_VERSION = "0.1.0" as const;

export type OxpHostPackage = typeof OXP_HOST_PACKAGE;
export type OxpHostVersion = typeof OXP_HOST_VERSION;
export type OxpExtensionPackage = typeof OXP_EXTENSION_PACKAGE;
export type OxpExtensionVersion = typeof OXP_EXTENSION_VERSION;

/**
 * The full set of WIT package@version strings this build of @oxprotocol/wit ships.
 * Hosts compare a manifest's pinned package@version against this list and
 * refuse to instantiate components targeting an unknown pin.
 */
export const SUPPORTED_WIT_PINS: readonly string[] = [
  `${OXP_HOST_PACKAGE}@${OXP_HOST_VERSION}`,
  `${OXP_EXTENSION_PACKAGE}@${OXP_EXTENSION_VERSION}`,
] as const;
