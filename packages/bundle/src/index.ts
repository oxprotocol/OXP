/**
 * @oxprotocol/bundle — pack, unpack, sign, verify `.oxp` bundles.
 *
 * Implements spec/v1/bundle.md:
 *   - deterministic POSIX tar (USTAR), mtime 1980-01-01, mode 0644/0755, uid/gid 0
 *   - oxp.json first, remaining entries lexicographic
 *   - zstd level 19 compression
 *   - bundle digest = sha256(UNCOMPRESSED tar stream)
 *   - Ed25519 signing (Sigstore added later)
 */

export { packBundle, type PackResult, type PackOptions } from "./pack.js";

export { unpackBundle, type UnpackResult } from "./unpack.js";

export {
  digestBundle,
  computeIntegrityManifest,
  type IntegrityManifest,
} from "./integrity.js";

export {
  signEd25519,
  verifyEd25519,
  keyIdOf,
  type Ed25519Signature,
  type Ed25519KeyPair,
  generateEd25519KeyPair,
} from "./sign-ed25519.js";

export {
  signSigstore,
  verifySigstore,
  extractVerification,
  canonicalPayloadFor,
  sha256Hex,
  type SigstoreBundle,
  type SigstoreSigner,
  type SigstoreVerification,
} from "./sign-sigstore.js";

export { BUNDLE_LIMITS } from "./limits.js";
export { decompressBundle } from "./decompress.js";

export {
  assertBundlePolicy,
  BundlePolicyError,
  type BundlePolicyOptions,
  type BundlePolicyViolationCode,
} from "./security.js";

export {
  assertWitPin,
  buildExtensionPin,
  WitPinError,
  type WitPinViolationCode,
} from "./wit-pin.js";

export {
  extractHostImports,
  findMissingPermissions,
  WIT_INTERFACE_REQUIREMENTS,
  type HostInterface,
  type PermissionGap,
} from "./wit-imports.js";
