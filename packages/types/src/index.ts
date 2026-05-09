/**
 * OXP manifest and protocol types — spec v1.
 *
 * These types are the TypeScript projection of `spec/v1/manifest.schema.json`.
 * They are authored by hand for ergonomic naming; the schema (in @oxprotocol/schema)
 * is the normative artifact. CI verifies the two stay in sync.
 */

export * from "./permissions.js";
export * from "./token-scopes.js";
export * from "./ui-tree.js";

export const SPEC_VERSION = "1" as const;
export type SpecVersion = typeof SPEC_VERSION;

// ──────────────────────────────────────────────────────────────────────
// Capabilities — Capability + Sensitivity now live in ./permissions.ts
// (canonical Phase A.2 source of truth, re-exported above).
// ──────────────────────────────────────────────────────────────────────

import type { Capability, Sensitivity } from "./permissions.js";

export interface Permission {
  id: Capability;
  /** Glob patterns scoping the capability. */
  scope?: string[];
  /** Plain-text reason shown to the user at install. */
  rationale: string;
  sensitivity?: Sensitivity;
}

// ──────────────────────────────────────────────────────────────────────
// Categories
// ──────────────────────────────────────────────────────────────────────

export type Category =
  | "ai"
  | "database"
  | "data-tools"
  | "debuggers"
  | "devops"
  | "editor"
  | "education"
  | "formatters"
  | "language-support"
  | "linters"
  | "notebooks"
  | "other"
  | "productivity"
  | "scm"
  | "snippets"
  | "testing"
  | "themes"
  | "visualization";

// ──────────────────────────────────────────────────────────────────────
// Hosts
// ──────────────────────────────────────────────────────────────────────

export type HostId =
  | "vscode"
  | "cursor"
  | "windsurf"
  | "vscodium"
  | "jetbrains"
  | "zed"
  | "theia"
  | "gitpod"
  | "coder"
  | "neovim"
  | "piye";

export type HostTier = "L0" | "L1" | "L2";

export interface HostCompat {
  minVersion?: string;
  maxVersion?: string;
  compatible?: boolean;
  tier?: HostTier;
  /** Required when compatible === false. */
  reason?: string;
}

// ──────────────────────────────────────────────────────────────────────
// UI
// ──────────────────────────────────────────────────────────────────────

export type UiComponentMode = "oxp-ui-only" | "oxp-ui-v1" | "escape-hatch";
export type UiSurface = "sidebar" | "panel" | "editor" | "modal" | "statusbar";

export interface UiHints {
  components?: UiComponentMode;
  preferredSurface?: UiSurface;
  themeable?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Contributions, activation, integrity
// ──────────────────────────────────────────────────────────────────────

export interface Contributes {
  commands?: string;
  views?: string;
  menus?: string;
  keybindings?: string;
  languages?: string;
  themes?: string;
  snippets?: string;
  settings?: string;
}

export type ActivationEvent =
  | "onStartup"
  | `onCommand:${string}`
  | `onView:${string}`
  | `onLanguage:${string}`
  | `onFileSystem:${string}`
  | `onUri:${string}`;

export type SignatureAlgo = "sigstore" | "ed25519";

export interface Integrity {
  bundleSha256: string;
  signedBy: string;
  signatureAlgo: SignatureAlgo;
  rekorLogIndex?: number;
}

/**
 * Phase A.11 — WIT contract pin. Required for bundles that ship a Wasm
 * component; optional for declarative-only `oxp-ui-v1` bundles. The
 * registry recomputes the canonical sha256 of the bundled wit/world.wit
 * at publish time and rejects mismatches; hosts refuse to instantiate
 * components pinned to a package@version they do not ship.
 */
export interface WitPin {
  /** v1 ships exactly one supported value: "oxp:extension". */
  package: "oxp:extension";
  /** v1 ships exactly one supported value: "0.1.0". */
  version: "0.1.0";
  /** Hex sha256 over the canonical form of the bundled WIT world. */
  sha256: string;
}

// ──────────────────────────────────────────────────────────────────────
// Resource limits (Phase A.12 / A.13 — WASM pivot)
// ──────────────────────────────────────────────────────────────────────

/**
 * Hard ceilings applied per extension instance / per host call.
 *
 * Defaults (`RUNTIME_LIMIT_DEFAULTS`) target the "lightest extension
 * ecosystem" goal — extensions should comfortably activate inside 100 ms
 * of wall time and 64 MB of linear memory. Manifest authors can opt up
 * to the documented maxima when they need it; the install prompt surfaces
 * any non-default request as an explicit user grant.
 *
 * The jco backend enforces `timeMsPerCall` via wall-clock interruption.
 * `maxMemoryMb` is recorded and forwarded to the wasmtime backend; under
 * jco we cannot enforce a hard cap because V8 owns the underlying
 * `WebAssembly.Memory` growth, so the value is treated as a hint and
 * a warning is logged if it diverges from the default.
 */
export interface RuntimeLimits {
  /** Wall-clock cap per host→component call. Default 100, max 5000. */
  timeMsPerCall?: number;
  /** Linear-memory cap in MiB per instance. Default 64, max 256. */
  maxMemoryMb?: number;
}

export const RUNTIME_LIMIT_DEFAULTS = {
  timeMsPerCall: 100,
  maxMemoryMb: 64,
} as const;

export const RUNTIME_LIMIT_MAX = {
  timeMsPerCall: 5_000,
  maxMemoryMb: 256,
} as const;

// ──────────────────────────────────────────────────────────────────────
// Bundle kind (WASM pivot — see ARCHITECTURE-WASM-PIVOT.md §2)
// ──────────────────────────────────────────────────────────────────────

/**
 * Coarse classification driving Phase A.10 policy:
 *   - `ui-v1`        — declarative tree only, no executable code
 *   - `component-v1` — ships a Wasm component, must declare a WIT pin
 *   - `hybrid-v1`    — both a UI tree and a Wasm component
 */
export type BundleKind = "ui-v1" | "component-v1" | "hybrid-v1";

/**
 * Derive `kind` from the legacy `ui.components` + `main` fields when a
 * manifest does not declare it explicitly. Existing bundles published
 * before the field was introduced default through this path so they
 * keep installing unchanged.
 *
 * Rules (in order):
 *   1. Explicit `manifest.kind` wins.
 *   2. `main.ui` set AND `main.wasm` set        → "hybrid-v1"
 *   3. `main.wasm` set AND `main.ui` not set    → "component-v1"
 *   4. otherwise (UI only / declarative)        → "ui-v1"
 */
export function deriveBundleKind(m: {
  kind?: BundleKind;
  main?: { ui?: string; wasm?: string };
  ui?: { components?: string };
}): BundleKind {
  if (m.kind) return m.kind;
  const hasUi = !!m.main?.ui;
  const hasWasm = !!m.main?.wasm;
  if (hasUi && hasWasm) return "hybrid-v1";
  if (hasWasm) return "component-v1";
  return "ui-v1";
}

// ──────────────────────────────────────────────────────────────────────
// Main entry — at least one of ui|wasm
// ──────────────────────────────────────────────────────────────────────

export type MainEntry =
  | { ui: string; wasm?: string }
  | { wasm: string; ui?: string };

export interface Engines {
  /** Semver range, e.g. "^1.0.0". */
  oxp: string;
}

/** Phase B.4 — reproducible-build provenance hints. All fields optional. */
export interface ManifestProvenance {
  /** Source commit SHA the bundle was built from (7–64 hex chars). */
  commit?: string;
  /** Single shell command that reproduces the bundle from a clean checkout. */
  buildCommand?: string;
  /** Free-form builder identifier ("github-actions", "local", …). */
  builder?: string;
  /** Source-tree URL pinned to the build commit. */
  sourceUrl?: string;
}

/**
 * Author-defined build hooks. Values are single shell commands executed via
 * `sh -c` from the project root. Both fields are optional; `oxp pack` runs
 * `build` automatically (npm-style), `oxp publish` runs `prepublish` after
 * a successful pack and before upload.
 */
export interface ManifestScripts {
  /** Produces the bundle artefacts (e.g. `cargo build && cp …`). */
  build?: string;
  /** Runs after pack, before upload (e.g. tests, attestation). */
  prepublish?: string;
}

export interface Telemetry {
  optIn: true;
  endpoint: string;
}

// ──────────────────────────────────────────────────────────────────────
// The manifest
// ──────────────────────────────────────────────────────────────────────

export interface OxpManifest {
  $schema?: string;
  specVersion: SpecVersion;
  /**
   * Bundle kind (Phase A.10 / WASM pivot). Optional — when omitted, hosts
   * and tooling derive it from `ui.components` + `main.wasm` per
   * `deriveBundleKind()`. New bundles SHOULD set this explicitly.
   */
  kind?: BundleKind;
  /** "@publisher/slug" */
  id: string;
  /** Strict semver 2.0.0. */
  version: string;
  displayName: string;
  description?: string;
  /** Lowercase, kebab-case publisher handle. Must equal id's publisher segment. */
  publisher: string;
  /** SPDX identifier, or "UNLICENSED". */
  license: string;
  homepage?: string;
  repository?: string;
  bugs?: string;
  /** Phase B.4 reproducible-build provenance hints. */
  provenance?: ManifestProvenance;
  /**
   * Author-defined build hooks. `oxp pack` runs `scripts.build` (when set)
   * before walking the bundle directory; `oxp publish` runs
   * `scripts.prepublish` after a successful pack and before upload. Each
   * value is a single shell command executed via `sh -c` with the project
   * root as cwd. Skip with `--no-build` / `--no-prepublish`.
   */
  scripts?: ManifestScripts;
  engines: Engines;
  categories?: Category[];
  keywords?: string[];
  icon?: string;
  main: MainEntry;
  activationEvents?: ActivationEvent[];
  permissions?: Permission[];
  contributes?: Contributes;
  ui?: UiHints;
  hosts?: Partial<Record<HostId, HostCompat>>;
  telemetry?: Telemetry;
  /** Set by `oxp publish`. Authors should not write this by hand. */
  integrity?: Integrity;
  /** Phase A.11 WIT contract pin. Required for component-bearing bundles. */
  wit?: WitPin;
  /** Phase A.12/A.13 resource limits. Defaults from `RUNTIME_LIMIT_DEFAULTS`. */
  limits?: RuntimeLimits;
}

// ──────────────────────────────────────────────────────────────────────
// Convenience type guards
// ──────────────────────────────────────────────────────────────────────

export function manifestHasUi(
  m: OxpManifest,
): m is OxpManifest & { main: { ui: string } } {
  return typeof m.main.ui === "string";
}

export function manifestHasWasm(
  m: OxpManifest,
): m is OxpManifest & { main: { wasm: string } } {
  return typeof m.main.wasm === "string";
}

// ──────────────────────────────────────────────────────────────────────
// @oxprotocol/ui v1 component tree (frozen vocab — DO NOT add nodes without
// bumping spec version)
// ──────────────────────────────────────────────────────────────────────

export type UiSpacing = 0 | 1 | 2 | 3 | 4 | 6 | 8;
export type UiAlign = "start" | "center" | "end" | "stretch";
export type UiTextVariant = "body" | "heading" | "caption" | "code";
export type UiButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface UiBoxNode {
  kind: "box";
  pad?: UiSpacing;
  gap?: UiSpacing;
  children?: UiNode[];
}

export interface UiStackNode {
  kind: "stack";
  /** Default "vertical". */
  axis?: "vertical" | "horizontal";
  gap?: UiSpacing;
  align?: UiAlign;
  children?: UiNode[];
}

export interface UiTextNode {
  kind: "text";
  value: string;
  variant?: UiTextVariant;
}

export interface UiButtonNode {
  kind: "button";
  label: string;
  /** Host-side action id; resolved by `HostApi.onAction`. */
  action: string;
  variant?: UiButtonVariant;
  disabled?: boolean;
}

export interface UiVirtualListNode {
  kind: "virtual-list";
  /** Pre-rendered items. The host MAY virtualise based on count. */
  items: UiNode[];
  /** Suggested fixed row height in CSS px. */
  rowHeight?: number;
}

export interface UiCodeBlockNode {
  kind: "code";
  value: string;
  /** Lowercase language id, e.g. "ts", "py", "json". */
  language?: string;
}

export type UiNode =
  | UiBoxNode
  | UiStackNode
  | UiTextNode
  | UiButtonNode
  | UiVirtualListNode
  | UiCodeBlockNode;

/** Top-level tree returned by an extension's `renderTree`. */
export type UiTree = UiNode | UiNode[];
