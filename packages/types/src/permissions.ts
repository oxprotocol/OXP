/**
 * Canonical permission catalog — Phase A foundation.
 *
 * This file is the SINGLE SOURCE OF TRUTH for what an OXP extension is
 * allowed to ask for. Any string appearing in `OxpManifest.permissions`
 * must reduce to one of these capability ids.
 *
 * Capability strings appear in two shapes:
 *   - bare:    "clipboard.read", "notifications.show"
 *   - scoped:  "fs.read:<glob>", "net.fetch:<host>", "secrets.read:<key>"
 *
 * The colon-scope form is normative; bare strings without a colon are
 * treated as "ambient" (no scope qualifier).
 *
 * DO NOT add a capability without:
 *   1. updating spec/v1/manifest.schema.json
 *   2. landing the host-side enforcement that gates it
 *   3. adding a Phase A test that proves enforcement works
 *
 * See ROADMAP-SECURITY.md Phase A.2.
 */

export const CAPABILITIES = [
  // Filesystem
  "fs.read",
  "fs.write",
  "fs.delete",
  "fs.watch",
  // Workspace (higher-level, scoped to the open workspace folder)
  "workspace.read",
  "workspace.write",
  // Network
  "net.fetch",
  // Clipboard
  "clipboard.read",
  "clipboard.write",
  // Notifications
  "notifications.show",
  // Secrets storage (per-extension keychain)
  "secrets.read",
  "secrets.write",
  // Inter-extension events
  "events.publish",
  "events.subscribe",
  // Host commands (executing built-in editor commands)
  "commands.executeHost",
  // === DANGER: requires verified publisher ===
  "terminal.spawn",
  "terminal.shell",
  "process.kill",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

/**
 * Capabilities that require the publisher to be domain-verified
 * (Phase B.1) before the registry will accept a manifest declaring them.
 * Today (pre-Phase-B) they may be authored but should fail policy on
 * publish unless explicitly allow-listed.
 */
export const VERIFIED_ONLY_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "terminal.spawn",
  "terminal.shell",
  "process.kill",
]);

/**
 * Sensitivity drives the install prompt UI (Phase A.4):
 *   - "ambient":      granted on install without per-action prompt (e.g. notifications)
 *   - "install-time": confirmed once on install, persisted thereafter
 *   - "sensitive":    re-prompt on each use until user opts out
 */
export type Sensitivity = "ambient" | "install-time" | "sensitive";

export const CAPABILITY_SENSITIVITY: Readonly<Record<Capability, Sensitivity>> =
  {
    "fs.read": "install-time",
    "fs.write": "install-time",
    "fs.delete": "sensitive",
    "fs.watch": "install-time",
    "workspace.read": "install-time",
    "workspace.write": "install-time",
    "net.fetch": "install-time",
    "clipboard.read": "sensitive",
    "clipboard.write": "install-time",
    "notifications.show": "ambient",
    "secrets.read": "sensitive",
    "secrets.write": "sensitive",
    "events.publish": "ambient",
    "events.subscribe": "ambient",
    "commands.executeHost": "install-time",
    "terminal.spawn": "sensitive",
    "terminal.shell": "sensitive",
    "process.kill": "sensitive",
  };

/** Plain-English descriptions used by the install-time prompt (Phase A.4). */
export const CAPABILITY_DESCRIPTIONS: Readonly<Record<Capability, string>> = {
  "fs.read": "Read files on your machine",
  "fs.write": "Write files on your machine",
  "fs.delete": "Delete files on your machine",
  "fs.watch": "Watch files for changes",
  "workspace.read": "Read files in your open workspace",
  "workspace.write": "Modify files in your open workspace",
  "net.fetch": "Make network requests",
  "clipboard.read": "Read your clipboard contents",
  "clipboard.write": "Replace your clipboard contents",
  "notifications.show": "Show desktop notifications",
  "secrets.read": "Read its own stored secrets",
  "secrets.write": "Store secrets in your keychain",
  "events.publish": "Send events to other extensions",
  "events.subscribe": "Receive events from other extensions",
  "commands.executeHost": "Run editor commands on your behalf",
  "terminal.spawn": "Start new processes on your machine",
  "terminal.shell": "Run shell commands on your machine",
  "process.kill": "Terminate processes on your machine",
};

/**
 * Parse a permission string into `(capability, scope?)`.
 * Returns null if the capability is not recognized.
 *
 *   parsePermission("net.fetch:api.github.com") → { capability: "net.fetch", scope: "api.github.com" }
 *   parsePermission("clipboard.read")           → { capability: "clipboard.read" }
 *   parsePermission("rm -rf /")                 → null
 */
export function parsePermission(
  s: string,
): { capability: Capability; scope?: string } | null {
  const colon = s.indexOf(":");
  const head = colon === -1 ? s : s.slice(0, colon);
  if (!CAPABILITY_SET.has(head)) return null;
  const cap = head as Capability;
  return colon === -1
    ? { capability: cap }
    : { capability: cap, scope: s.slice(colon + 1) };
}

export function isCapability(s: string): s is Capability {
  return CAPABILITY_SET.has(s);
}
