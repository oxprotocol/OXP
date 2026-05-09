/**
 * Phase A.11 — host-side WIT contract pin verification.
 *
 * This is the install-boundary mirror of the registry's `assertWitPin`
 * check. The registry refuses to *publish* a bundle whose declared WIT
 * pin disagrees with the server's local @oxprotocol/wit. The host repeats the
 * check here so a host running an older / patched / vendored copy of
 * @oxprotocol/wit refuses to instantiate components built against a contract
 * it does not actually implement.
 *
 * Defense-in-depth scenarios this catches:
 *   - Compromised registry serves a tampered manifest
 *   - User installs a bundle from a private mirror that did not run
 *     server-side checks
 *   - Host was built against @oxprotocol/wit@A but the bundle targets @oxprotocol/wit@B
 *
 * Called from `resolveAndVerify()` after the manifest is parsed but
 * before the install record is committed.
 */

import {
  worldSha256,
  OXP_EXTENSION_PACKAGE,
  OXP_EXTENSION_VERSION,
  SUPPORTED_WIT_PINS,
} from "@oxprotocol/wit";
import { VerifyError, type ManifestCommon } from "./types.js";

/**
 * Coarse kind classification, kept in sync with `@oxprotocol/types/deriveBundleKind`.
 * Duplicated here (rather than imported) so host-core stays free of the
 * bundle-side type aliases — `ManifestCommon` is the host's own surface.
 *
 * Exported because the activator (and host adapters) need to know whether
 * a record represents a runnable component before trying to load it.
 */
export function kindOf(
  m: ManifestCommon & Record<string, unknown>,
): "ui-v1" | "component-v1" | "hybrid-v1" {
  if (m.kind) return m.kind;
  const hasUi = !!m.main?.ui;
  const hasWasm = !!m.main?.wasm;
  if (hasUi && hasWasm) return "hybrid-v1";
  if (hasWasm) return "component-v1";
  return "ui-v1";
}

/**
 * Throws `VerifyError` on the first violation. Safe to call on every
 * manifest that flows through `resolveAndVerify`.
 *
 * Behavior by kind:
 *   - `ui-v1`        → pin OPTIONAL; if present, still validated
 *   - `component-v1` → pin REQUIRED
 *   - `hybrid-v1`    → pin REQUIRED
 */
export function assertHostWitPin(
  manifest: ManifestCommon & Record<string, unknown>,
): void {
  const kind = kindOf(manifest);
  const pin = manifest.wit;

  if (!pin) {
    if (kind === "ui-v1") return;
    throw new VerifyError(
      `${kind} bundles must declare manifest.wit (Phase A.11). This host expects "${OXP_EXTENSION_PACKAGE}@${OXP_EXTENSION_VERSION}".`,
      "WIT_PIN_REQUIRED",
    );
  }

  const declared = `${pin.package}@${pin.version}`;
  const expectedPin = `${OXP_EXTENSION_PACKAGE}@${OXP_EXTENSION_VERSION}`;
  if (declared !== expectedPin || !SUPPORTED_WIT_PINS.includes(declared)) {
    throw new VerifyError(
      `unsupported WIT pin ${declared}. This host only links "${expectedPin}".`,
      "WIT_PIN_UNSUPPORTED",
    );
  }

  // Authoritative comparison against the host's local WIT files.
  const expected = worldSha256();
  if (pin.sha256 !== expected) {
    throw new VerifyError(
      `manifest.wit.sha256 does not match this host's WIT contract for ${declared}. The bundle was built against a different revision of @oxprotocol/wit — refuse to instantiate.`,
      "WIT_PIN_HASH_MISMATCH",
    );
  }
}
