/**
 * Multi-select install-time permission prompt for the Rust-runtime path.
 *
 * Mirrors the legacy jco-backend prompt in `host-core` but uses VS Code's
 * native QuickPick so the user sees the canonical capability descriptions
 * from `@oxprotocol/types`. Returns the chosen scope strings, or `undefined`
 * if the user cancelled.
 */

import * as vscode from "vscode";
import {
  CAPABILITIES,
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_SENSITIVITY,
  VERIFIED_ONLY_CAPABILITIES,
  type Capability,
} from "@oxprotocol/types";

export async function promptForPermissions(opts: {
  extensionId: string;
  /** Pre-selected scopes (e.g. those declared in a manifest). */
  preselected?: readonly string[];
  /** Restrict the choices to a subset (e.g. only what the bundle imports). */
  restrictTo?: readonly string[];
}): Promise<string[] | undefined> {
  const all = (
    opts.restrictTo?.length ? opts.restrictTo : CAPABILITIES
  ) as readonly string[];
  const items: (vscode.QuickPickItem & { value: string })[] = all.map(
    (scope) => {
      const cap = scope as Capability;
      const sens = CAPABILITY_SENSITIVITY[cap] ?? "install-time";
      const verifiedOnly = VERIFIED_ONLY_CAPABILITIES.has(cap);
      return {
        value: scope,
        label: scope,
        description: CAPABILITY_DESCRIPTIONS[cap] ?? "(unknown capability)",
        detail: [
          sens === "sensitive"
            ? "$(warning) sensitive — re-prompts each use"
            : null,
          verifiedOnly ? "$(verified) requires verified publisher" : null,
        ]
          .filter(Boolean)
          .join("  ·  "),
        picked: opts.preselected?.includes(scope) ?? false,
      };
    },
  );

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `Grant permissions to ${opts.extensionId}`,
    placeHolder:
      "Select the capabilities this extension may use. Press Esc to cancel install.",
    ignoreFocusOut: true,
  });
  if (!picked) return undefined;
  return picked.map((p) => p.value);
}
