/**
 * Bundle policy enforcement — Phase A.10 + Phase A.3 (manifest perms).
 *
 * `assertBundlePolicy` runs at TWO points in the lifecycle:
 *
 *   1. `oxp pack` — before writing the .oxp on the author's machine,
 *      so authors get fast local feedback.
 *   2. Registry publish handler — re-checks server-side, because a hostile
 *      author could bypass the CLI and POST a hand-crafted bundle directly.
 *
 * Both call sites MUST run this. There is no client-trust path.
 *
 * Today this enforces:
 *   - A.10: `oxp-ui-v1` bundles cannot ship executable code.
 *   - A.3:  Every entry in `manifest.permissions` (string[]) must parse to
 *           a known capability. Unknown / typo'd permissions hard-fail.
 *   - A.3:  `terminal.*` and `process.kill` are denied unless the bundle
 *           is from a verified publisher (carried in opts).
 *
 * Future phases will extend this with: bundle-size class limits per surface,
 * static-analysis heuristics, indicator-of-compromise scans (Phase B.3).
 */

import {
  deriveBundleKind,
  parsePermission,
  VERIFIED_ONLY_CAPABILITIES,
  type BundleKind,
} from "@oxprotocol/types";

/**
 * File extensions that count as "executable code" for any bundle kind.
 * `.wasm` is intentionally NOT in here: it is the *only* code form
 * permitted in `component-v1` / `hybrid-v1` bundles, and is rejected
 * for `ui-v1` by the kind-specific rule below.
 */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  // shell / native — never allowed in v1 regardless of kind
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".exe",
  ".dll",
  ".dylib",
  ".so",
]);

export interface BundlePolicyManifestSlice {
  id?: string;
  kind?: BundleKind;
  main?: { ui?: string; wasm?: string };
  permissions?: unknown;
  ui?: { components?: string } | unknown;
}

export interface BundlePolicyOptions {
  /**
   * If true, capabilities in VERIFIED_ONLY_CAPABILITIES are allowed.
   * Set this only at the registry boundary, after publisher verification
   * (Phase B.1). The CLI calls this with `false` because the CLI cannot
   * know if the registry has marked the publisher as verified.
   */
  publisherVerified?: boolean;
}

export type BundlePolicyViolationCode =
  | "UI_V1_CONTAINS_CODE"
  | "COMPONENT_MISSING_WASM"
  | "SCRIPT_FORBIDDEN"
  | "UNKNOWN_PERMISSION"
  | "PERMISSIONS_NOT_ARRAY"
  | "PERMISSION_NOT_STRING"
  | "VERIFIED_ONLY_CAPABILITY"
  | "WASM_FILE_MISSING";

export class BundlePolicyError extends Error {
  constructor(
    message: string,
    public code: BundlePolicyViolationCode,
    public details?: { path?: string; permission?: string },
  ) {
    super(message);
    this.name = "BundlePolicyError";
  }
}

/**
 * Throws BundlePolicyError on first violation. Callers should catch and
 * convert to whatever error shape they speak (CLI exit code, HTTP 4xx).
 */
export function assertBundlePolicy(
  manifest: BundlePolicyManifestSlice,
  filePaths: Iterable<string>,
  opts: BundlePolicyOptions = {},
): void {
  // Materialize once — we may iterate twice (kind rules + script scan).
  const paths = Array.from(filePaths);

  // ── A.10 — kind-scoped artifact rules (WASM pivot) ───────────────────
  // Legacy compat: if ui.components === "oxp-ui-v1" treat as ui-v1 even
  // when manifest.kind is unset.
  const legacyUiV1 =
    (manifest.ui as { components?: string } | undefined)?.components ===
    "oxp-ui-v1";
  const kind: BundleKind = manifest.kind
    ? manifest.kind
    : legacyUiV1
      ? "ui-v1"
      : deriveBundleKind({ kind: manifest.kind, main: manifest.main });

  if (kind === "ui-v1") {
    for (const p of paths) {
      const ext = extOf(p);
      if (ext === ".wasm" || SCRIPT_EXTENSIONS.has(ext)) {
        throw new BundlePolicyError(
          `${kind} bundles cannot contain executable code, but found: ${p}. Set manifest.kind to "component-v1" or "hybrid-v1" if this is intentional.`,
          "UI_V1_CONTAINS_CODE",
          { path: p },
        );
      }
    }
  } else {
    // component-v1 / hybrid-v1: .wasm is the ONLY code form allowed.
    // Scripts (.js, .sh, native) remain forbidden across the board.
    for (const p of paths) {
      const ext = extOf(p);
      if (SCRIPT_EXTENSIONS.has(ext)) {
        throw new BundlePolicyError(
          `${kind} bundles may only contain .wasm code, but found script: ${p}.`,
          "SCRIPT_FORBIDDEN",
          { path: p },
        );
      }
    }
    // component-v1 must declare a wasm entry. hybrid-v1 must too.
    if (!manifest.main?.wasm) {
      throw new BundlePolicyError(
        `${kind} bundles must declare main.wasm`,
        "COMPONENT_MISSING_WASM",
      );
    }
    // The declared wasm file must actually be present in the bundle
    // (hosts cannot instantiate what isn't there). Catches the common
    // "forgot to copy target/.../foo.wasm into dist/" footgun before
    // the .oxp ever leaves the author's machine.
    if (!paths.includes(manifest.main.wasm)) {
      throw new BundlePolicyError(
        `${kind} bundle declares main.wasm="${manifest.main.wasm}" but that file is not present in the bundle.`,
        "WASM_FILE_MISSING",
        { path: manifest.main.wasm },
      );
    }
  }

  // ── A.3 — Permissions must be a string[] of known capabilities ───────
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      throw new BundlePolicyError(
        `manifest.permissions must be an array of strings`,
        "PERMISSIONS_NOT_ARRAY",
      );
    }
    for (const entry of manifest.permissions as unknown[]) {
      // Some authors use the structured Permission { id, scope, rationale }
      // shape. Accept both shapes; pull the wire-string out of structured.
      const wireString =
        typeof entry === "string"
          ? entry
          : entry &&
              typeof entry === "object" &&
              typeof (entry as { id?: unknown }).id === "string"
            ? scopedString(entry as { id: string; scope?: unknown })
            : null;
      if (wireString === null) {
        throw new BundlePolicyError(
          `manifest.permissions entries must be strings or {id, scope?} objects`,
          "PERMISSION_NOT_STRING",
        );
      }
      const parsed = parsePermission(wireString);
      if (!parsed) {
        throw new BundlePolicyError(
          `unknown permission: "${wireString}"`,
          "UNKNOWN_PERMISSION",
          { permission: wireString },
        );
      }
      if (
        !opts.publisherVerified &&
        VERIFIED_ONLY_CAPABILITIES.has(parsed.capability)
      ) {
        throw new BundlePolicyError(
          `capability "${parsed.capability}" is restricted to verified publishers`,
          "VERIFIED_ONLY_CAPABILITY",
          { permission: wireString },
        );
      }
    }
  }
}

function scopedString(p: { id: string; scope?: unknown }): string {
  if (Array.isArray(p.scope) && p.scope.length > 0) {
    // structured form may carry multiple scopes — collapse to the first
    // for parse-validation. The host enforces the full array at runtime.
    return `${p.id}:${String(p.scope[0])}`;
  }
  return p.id;
}

function extOf(p: string): string {
  const dot = p.lastIndexOf(".");
  return dot < 0 ? "" : p.slice(dot).toLowerCase();
}
