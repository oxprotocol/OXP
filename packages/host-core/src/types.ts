/**
 * Wire types — exact shapes returned by the OXP registry HTTP API.
 * These mirror apps/web/app/api/v1/* response bodies.
 */

export interface ResolveResponse {
  id: string;
  version: string;
  bundleUrl: string;
  signatureUrl: string;
  bundleSha256?: string;
  manifest?: unknown;
}

export interface SignatureFile {
  alg: "ed25519";
  keyId: string;
  payload: { digest: string; signedAt: string };
  signature: string;
}

export interface PublisherKey {
  keyId: string;
  publicKeyPem: string;
  revokedAt: string | null;
}

export interface PublisherKeysResponse {
  keys: PublisherKey[];
}

/**
 * The minimum manifest fields host-core relies on.
 * Hosts may read additional fields directly from `manifest` after install.
 */
export interface ManifestCommon {
  specVersion: string;
  /**
   * Bundle kind (WASM pivot — see ARCHITECTURE-WASM-PIVOT.md). Optional
   * on the wire so older bundles keep installing; if absent the host
   * derives it from `main.wasm` + `ui.components` per `deriveBundleKind()`.
   */
  kind?: "ui-v1" | "component-v1" | "hybrid-v1";
  id: string;
  publisher: string;
  version: string;
  displayName: string;
  description?: string;
  permissions?: string[];
  main?: { ui?: string; entry?: string; wasm?: string };
  ui?: {
    components?: "oxp-ui-only" | "html" | "mixed" | "oxp-ui-v1" | string;
    preferredSurface?: "panel" | "sidebar" | "modal";
  };
  /**
   * Phase A.11 — WIT contract pin. Required for component-v1 / hybrid-v1
   * bundles; optional for ui-v1. Verified at install time against the
   * host's local @oxprotocol/wit world hash.
   */
  wit?: {
    package: "oxp:extension";
    version: "0.1.0";
    sha256: string;
  };
  compat?: "oxp" | "vsx";
}

/**
 * Output of resolveAndVerify(): a fully-verified, in-memory bundle ready to install.
 * `files` keys are POSIX paths relative to the bundle root.
 */
export interface VerifiedBundle {
  id: string;
  version: string;
  publisher: string;
  slug: string;
  manifest: ManifestCommon & Record<string, unknown>;
  files: Map<string, Uint8Array>;
  tarSha256: string;
  keyId: string;
}

/**
 * A successfully installed extension as recorded in the host's index.
 * Hosts may extend this with platform-specific metadata.
 */
export interface InstalledRecord {
  id: string;
  version: string;
  publisher: string;
  slug: string;
  installedAt: string;
  keyId: string;
  tarSha256: string;
  manifest: ManifestCommon & Record<string, unknown>;
  /** POSIX-style relative paths inside the install dir. */
  files: string[];
  /**
   * Phase A.4 — the exact `manifest.permissions` strings the user
   * approved at install time. A subset of `manifest.permissions`.
   * Empty array means "approved with zero capabilities" (still
   * installable; broker rejects every gated call). Absent (legacy
   * record from before A.4) means the activator must refuse to start
   * the extension until the user is re-prompted.
   */
  grantedPermissions?: string[];
}

export type VerifyErrorCode =
  | "BAD_ID"
  | "RESOLVE_FAILED"
  | "FETCH_FAILED"
  | "KEYS_FAILED"
  | "DIGEST_MISMATCH"
  | "SIG_DIGEST_MISMATCH"
  | "UNKNOWN_KEY"
  | "KEY_REVOKED"
  | "SIG_VERIFY_FAILED"
  | "NO_MANIFEST"
  | "BAD_MANIFEST"
  | "UNSAFE_PATH"
  | "KEY_PINNING_VIOLATION"
  | "WIT_PIN_REQUIRED"
  | "WIT_PIN_UNSUPPORTED"
  | "WIT_PIN_HASH_MISMATCH"
  | "MANIFEST_PERMISSIONS_INSUFFICIENT"
  | "PERMISSION_DENIED_BY_USER"
  | "PERMISSIONS_NOT_GRANTED"
  | "DEV_INFO_FAILED"
  | "DEV_NOT_DEV"
  | "DEV_BUNDLE_FAILED";

export class VerifyError extends Error {
  constructor(
    message: string,
    public code: VerifyErrorCode,
  ) {
    super(message);
    this.name = "VerifyError";
  }
}
