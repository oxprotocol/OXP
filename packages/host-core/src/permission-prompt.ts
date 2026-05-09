/**
 * Phase A.4 — install-time permission prompt contract.
 *
 * The contract is host-agnostic. host-core decides *when* to prompt
 * (fresh install vs version upgrade with new permissions) and *what*
 * to ask about (which permissions, which sensitivities). The host
 * adapter (VS Code, Piye) decides *how* to render the prompt.
 *
 * Default behaviour when no host adapter is wired: deny everything.
 * That's the safe choice — an extension that asked for `fs.read` and
 * is silently granted nothing will fail loudly at first call rather
 * than running with elevated privileges the user never saw.
 */

import {
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_SENSITIVITY,
  parsePermission,
  type Capability,
  type Sensitivity,
} from "@oxprotocol/types";

/** One row in the prompt UI. Pre-decoded so the host can render directly. */
export interface PermissionPromptItem {
  /** The exact permission string from `manifest.permissions`. */
  raw: string;
  /** The capability id without scope (e.g. `"fs.read"`). */
  capability: Capability;
  /** Optional scope (e.g. `"**"` for fs, `"api.github.com"` for net). */
  scope?: string;
  /** Plain-English summary for non-technical users. */
  description: string;
  /** Drives badge colour / "this re-prompts on every use" hints. */
  sensitivity: Sensitivity;
  /**
   * True when this row was already approved by the user in a previous
   * install of the same `(publisher, slug)` and we are re-prompting
   * only because *new* permissions were added in a version upgrade.
   * The host UI should pre-tick these so the user can see what they
   * already agreed to.
   */
  previouslyGranted: boolean;
}

/** What the prompt callback receives. */
export interface PermissionPromptRequest {
  extensionId: string;
  publisher: string;
  slug: string;
  version: string;
  displayName: string;
  /** Every permission the extension is asking for, decoded for display. */
  items: readonly PermissionPromptItem[];
  /** True iff this is a re-prompt triggered by a version upgrade. */
  isUpgrade: boolean;
}

/** What the host adapter returns. */
export type PermissionPromptDecision =
  | {
      kind: "grant";
      /**
       * Subset of the request's `items[].raw` strings the user
       * approved. Anything not in this set is treated as denied.
       * Empty array = "approved with no permissions" — install
       * proceeds, but the broker will reject every gated call.
       */
      grantedRaw: string[];
    }
  | {
      kind: "deny";
      /** Optional reason captured for diagnostics / dashboard. */
      reason?: string;
    };

export type PermissionPromptFn = (
  req: PermissionPromptRequest,
) => Promise<PermissionPromptDecision>;

/**
 * Default. Refuses every install that requests any non-ambient
 * capability. Used when a host forgets to wire its prompt.
 */
export const denyAllPrompt: PermissionPromptFn = async () => ({
  kind: "deny",
  reason: "no permission prompt configured on host",
});

/**
 * Test-only. Approves every requested permission. Never use in
 * production hosts; `RuntimeManager` will activate components with
 * full granted scope.
 */
export const allowAllPrompt: PermissionPromptFn = async (req) => ({
  kind: "grant",
  grantedRaw: req.items.map((i) => i.raw),
});

/**
 * Build the per-row metadata the prompt needs from a manifest's
 * raw `permissions` array. Unknown permission strings are silently
 * dropped — `assertBundlePolicy` already rejects them at publish
 * time, and during a defensive sideload the broker will refuse them
 * anyway. Ambient capabilities (sensitivity === "ambient") are
 * filtered out: they are granted automatically and asking the user
 * about them is noise.
 */
export function buildPromptItems(
  permissions: readonly string[],
  previouslyGrantedRaw: ReadonlySet<string>,
): PermissionPromptItem[] {
  const items: PermissionPromptItem[] = [];
  const seen = new Set<string>();
  for (const raw of permissions) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const parsed = parsePermission(raw);
    if (!parsed) continue;
    const sensitivity = CAPABILITY_SENSITIVITY[parsed.capability];
    if (sensitivity === "ambient") continue;
    items.push({
      raw,
      capability: parsed.capability,
      scope: parsed.scope,
      description: CAPABILITY_DESCRIPTIONS[parsed.capability],
      sensitivity,
      previouslyGranted: previouslyGrantedRaw.has(raw),
    });
  }
  return items;
}
