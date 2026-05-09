/**
 * Phase A.11 — server-side WIT contract pin verification.
 *
 * Authors declare `manifest.wit = { package, version, sha256 }`. The
 * registry recomputes the canonical sha256 of the WIT world for the
 * declared `package@version` (using @oxprotocol/wit's local copy) and compares.
 *
 * This catches:
 *   - Forged pins claiming an older / different contract than the host
 *     actually ships ("downgrade attack")
 *   - Stale author tooling whose WIT files drifted from the spec
 *   - Typos in the declared package@version
 *
 * Hosts perform a parallel check at instantiate time before linking
 * the component (lands with @oxprotocol/host-runtime, week 3).
 */

import {
  OXP_EXTENSION_PACKAGE,
  OXP_EXTENSION_VERSION,
  SUPPORTED_WIT_PINS,
  worldSha256,
  type WitPin as ShippedWitPin,
} from "@oxprotocol/wit";
import { deriveBundleKind, type BundleKind, type WitPin } from "@oxprotocol/types";

export type WitPinViolationCode =
  | "WIT_PIN_REQUIRED"
  | "WIT_PIN_UNSUPPORTED"
  | "WIT_PIN_HASH_MISMATCH";

export class WitPinError extends Error {
  constructor(
    message: string,
    public code: WitPinViolationCode,
    public details?: { expected?: string; actual?: string },
  ) {
    super(message);
    this.name = "WitPinError";
  }
}

export interface WitPinCheckSlice {
  kind?: BundleKind;
  main?: { ui?: string; wasm?: string };
  ui?: { components?: string };
  wit?: WitPin;
}

/**
 * Throws WitPinError on first violation. Safe to call from both `oxp pack`
 * (early author feedback) and the registry publish handler (authoritative).
 *
 * Behavior by kind:
 *   - `ui-v1`              — pin is OPTIONAL; if present, still validated.
 *   - `component-v1`       — pin is REQUIRED.
 *   - `hybrid-v1`          — pin is REQUIRED.
 */
export function assertWitPin(manifest: WitPinCheckSlice): void {
  const kind = deriveBundleKind(manifest);
  const pin = manifest.wit;

  if (!pin) {
    if (kind === "ui-v1") return; // declarative-only, no contract surface
    throw new WitPinError(
      `${kind} bundles must declare manifest.wit (Phase A.11). Expected package "${OXP_EXTENSION_PACKAGE}@${OXP_EXTENSION_VERSION}".`,
      "WIT_PIN_REQUIRED",
    );
  }

  const declared = `${pin.package}@${pin.version}`;
  // Manifests only ever pin the *extension* world (the surface the
  // component itself implements). The host world is internal to @oxprotocol/wit
  // and is never declared by authors. Reject anything else even if it
  // happens to appear in SUPPORTED_WIT_PINS.
  const expectedPin = `${OXP_EXTENSION_PACKAGE}@${OXP_EXTENSION_VERSION}`;
  if (declared !== expectedPin || !SUPPORTED_WIT_PINS.includes(declared)) {
    throw new WitPinError(
      `unsupported WIT pin ${declared}. Manifests must pin "${expectedPin}".`,
      "WIT_PIN_UNSUPPORTED",
      { expected: expectedPin, actual: declared },
    );
  }

  // The pin is the hash of the WIT world the author claims to have built
  // against. Recompute from this server's local copy and compare.
  const expected = worldSha256();
  if (pin.sha256 !== expected) {
    throw new WitPinError(
      `manifest.wit.sha256 does not match this server's WIT contract for ${declared}. The author may be using stale tooling — regenerate with the latest @oxprotocol/cli.`,
      "WIT_PIN_HASH_MISMATCH",
      { expected, actual: pin.sha256 },
    );
  }
}

/** Convenience: build the pin a fresh CLI would write into `oxp pack`. */
export function buildExtensionPin(): ShippedWitPin {
  return {
    package: OXP_EXTENSION_PACKAGE,
    version: OXP_EXTENSION_VERSION,
    sha256: worldSha256(),
  };
}
