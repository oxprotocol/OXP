/**
 * Phase A.4 — install orchestrator.
 *
 * Combines `resolveAndVerify` (signature + WIT pin), the WIT-import
 * gate (`findMissingPermissions`), the persisted grants store, and
 * the host-supplied permission prompt into a single entry point that
 * hosts call instead of `Store.install` directly.
 *
 * Decision flow:
 *
 *  1. Resolve + verify the bundle (signature, WIT pin). Throws on failure.
 *  2. Read the component's WIT imports from the .wasm bytes (if any).
 *  3. Verify `manifest.permissions` covers every imported interface.
 *     A failure here means the registry let through a bundle whose
 *     binary asks for capabilities the manifest didn't declare —
 *     refuse to install (defence-in-depth; the registry should have
 *     caught this).
 *  4. Look up any prior grant for `(publisher, slug)`.
 *  5. If a prior grant exists AND no new permissions appear vs what
 *     the user previously saw, reuse the granted set — no prompt.
 *  6. Otherwise build the prompt items, call the host prompt, and
 *     persist the user's decision.
 *  7. Persist the install with the granted permissions recorded on
 *     the `InstalledRecord` so the activator can enforce them later.
 *
 * The prompt is bypassed entirely when the manifest requests no
 * non-ambient permissions — there is nothing to consent to.
 */

import { resolveAndVerify } from "./verify.js";
import type { Store } from "./store.js";
import type { Grants } from "./grants.js";
import { addedPermissions } from "./grants.js";
import {
  buildPromptItems,
  denyAllPrompt,
  type PermissionPromptFn,
  type PermissionPromptRequest,
} from "./permission-prompt.js";
import { extractHostImports, findMissingPermissions } from "@oxprotocol/bundle/wit-imports";
import type { InstalledRecord, VerifiedBundle } from "./types.js";
import { VerifyError } from "./types.js";

export interface InstallWithConsentOptions {
  registry: string;
  id: string;
  store: Store;
  grants: Grants;
  /**
   * Host-supplied prompt. Defaults to `denyAllPrompt` (refuses anything
   * non-ambient) so a host that forgets to wire one fails closed.
   */
  prompt?: PermissionPromptFn;
}

export interface InstallWithConsentResult {
  record: InstalledRecord;
  /** True iff the user saw a prompt during this install. */
  prompted: boolean;
}

export async function installWithConsent(
  opts: InstallWithConsentOptions,
): Promise<InstallWithConsentResult> {
  const prompt = opts.prompt ?? denyAllPrompt;

  // Step 1 — resolve + verify (signature, WIT pin).
  const verified = await resolveAndVerify(opts.registry, opts.id);

  return finishInstallWithConsent(verified, opts.store, opts.grants, prompt);
}

/**
 * Lower-level entry point that takes an already-`resolveAndVerify`'d
 * bundle. Useful for tests, sideloads, and dev-mode installs that
 * supply their own bytes.
 */
export async function finishInstallWithConsent(
  verified: VerifiedBundle,
  store: Store,
  grants: Grants,
  prompt: PermissionPromptFn,
): Promise<InstallWithConsentResult> {
  const requestedRaw: readonly string[] = verified.manifest.permissions ?? [];

  // Step 2 — extract WIT imports from the component bytes (if any).
  const wasmRel = verified.manifest.main?.wasm;
  const wasmBytes = wasmRel ? verified.files.get(wasmRel) : undefined;
  const imports = wasmBytes ? extractHostImports(wasmBytes) : new Set<never>();

  // Step 3 — manifest must cover every imported interface.
  const gaps = findMissingPermissions(imports, requestedRaw);
  if (gaps.length > 0) {
    const gapDesc = gaps
      .map(
        (g) =>
          `oxp:host/${g.interface} requires one of [${g.oneOf.join(", ")}]`,
      )
      .join("; ");
    throw new VerifyError(
      `${verified.id}@${verified.version}: component imports interfaces ` +
        `that manifest.permissions does not cover: ${gapDesc}. ` +
        `Refusing to install (registry should have caught this).`,
      "MANIFEST_PERMISSIONS_INSUFFICIENT",
    );
  }

  // Step 4 — look up prior grant.
  const prior = await grants.get(verified.publisher, verified.slug);

  // Step 5 — decide whether to skip prompting.
  const newSinceLastPrompt = prior
    ? addedPermissions(prior.lastSeenManifestPermissions, requestedRaw)
    : (requestedRaw as string[]);

  // Build prompt items (filters out ambient-only). If the resulting
  // list is empty there is nothing to ask the user about.
  const previouslyGrantedSet = new Set(prior?.granted ?? []);
  const items = buildPromptItems(requestedRaw, previouslyGrantedSet);

  let granted: string[];
  let prompted = false;

  if (items.length === 0) {
    // Nothing non-ambient. Implicit grant of whatever the manifest
    // declared (the broker still gates each call individually).
    granted = [...requestedRaw];
  } else if (prior && newSinceLastPrompt.length === 0) {
    // Re-install / version upgrade where the user already saw every
    // permission in the new manifest. Reuse the prior decision.
    granted = prior.granted.filter((p) => requestedRaw.includes(p));
  } else {
    // Step 6 — prompt.
    prompted = true;
    const req: PermissionPromptRequest = {
      extensionId: verified.id,
      publisher: verified.publisher,
      slug: verified.slug,
      version: verified.version,
      displayName:
        (verified.manifest.displayName as string | undefined) ?? verified.id,
      items,
      isUpgrade: Boolean(prior),
    };
    const decision = await prompt(req);
    if (decision.kind === "deny") {
      throw new VerifyError(
        `${verified.id}@${verified.version}: install refused by user` +
          (decision.reason ? ` (${decision.reason})` : ""),
        "PERMISSION_DENIED_BY_USER",
      );
    }
    // Constrain to actually-requested raw strings (defence vs prompts
    // that try to grant capabilities the manifest didn't ask for).
    const requestedSet = new Set(requestedRaw);
    granted = decision.grantedRaw.filter((p) => requestedSet.has(p));
  }

  // Persist the user's decision.
  await grants.set({
    publisher: verified.publisher,
    slug: verified.slug,
    granted,
    decidedAt: new Date().toISOString(),
    lastSeenVersion: verified.version,
    lastSeenManifestPermissions: [...requestedRaw],
  });

  // Step 7 — persist the install with the granted set on the record.
  const record = await store.install(verified, { grantedPermissions: granted });
  return { record, prompted };
}
