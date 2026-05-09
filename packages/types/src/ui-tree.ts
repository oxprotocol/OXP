/**
 * `oxp-ui-v1` — Minimal cross-host UI tree.
 *
 * Components serialise a `UiNode` tree as JSON, encode it to UTF-8, and
 * call `host.ui.render(bytes)`. The Rust runtime forwards the JSON to
 * whichever IDE host is driving us via the `host/ui-render` notification.
 * Each host renders the tree using its native widget kit:
 *
 *   - VS Code  → an HTML webview (one per instance)
 *   - JetBrains → a Swing JPanel inside an extension-scoped tool window
 *   - Neovim    → a buffer-backed view (best-effort)
 *
 * User input flows back as `extension/event` notifications carrying a
 * `UiEvent` JSON payload, decoded by the component's `ui-handler.on-event`.
 *
 * Design constraints kept this small on purpose:
 *   - JSON, not msgpack — we want it human-readable in logs.
 *   - Declarative, no callbacks-by-reference — the only handle the
 *     component has on a widget is its `id` string.
 *   - No layout engine beyond row/column flex — anything more elaborate
 *     belongs to the component (HTML in a custom-render escape hatch).
 *   - Every node carries an optional `id`, used both for event routing
 *     and for stable host-side reconciliation when the next render
 *     arrives.
 */

export type UiNode =
  | UiBox
  | UiText
  | UiButton
  | UiInput
  | UiSelect
  | UiCheckbox
  | UiDivider
  | UiSpacer;

export interface UiBox {
  kind: "box";
  /** Layout axis. Defaults to `column`. */
  layout?: "row" | "column";
  /** Pixel gap between children. Defaults to 6. */
  gap?: number;
  /** Pixel inner padding. Defaults to 0. */
  padding?: number;
  /** Optional id (used for replacement-by-id during reconciliation). */
  id?: string;
  children: UiNode[];
}

export interface UiText {
  kind: "text";
  content: string;
  size?: "xs" | "sm" | "md" | "lg";
  weight?: "normal" | "bold";
  /** Hex (`#rrggbb`) or one of `muted`, `error`, `accent`. */
  color?: string;
  id?: string;
}

export interface UiButton {
  kind: "button";
  /** Stable id — the only thing your component sees in the click event. */
  id: string;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export interface UiInput {
  kind: "input";
  id: string;
  value?: string;
  placeholder?: string;
  /** When true, host should mask the value (passwords, tokens). */
  secret?: boolean;
}

export interface UiSelect {
  kind: "select";
  id: string;
  options: { label: string; value: string }[];
  value?: string;
}

export interface UiCheckbox {
  kind: "checkbox";
  id: string;
  label: string;
  checked?: boolean;
}

export interface UiDivider {
  kind: "divider";
}

export interface UiSpacer {
  kind: "spacer";
  size: number;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** A user interaction the host forwards back to the component. */
export type UiEvent =
  | { type: "click"; id: string }
  | { type: "input"; id: string; value: string }
  | { type: "submit"; id?: string; values: Record<string, string> };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Walk the tree and return every node whose `kind === "input"`. */
export function inputs(root: UiNode): UiInput[] {
  const acc: UiInput[] = [];
  walk(root, (n) => {
    if (n.kind === "input") acc.push(n);
  });
  return acc;
}

export function walk(node: UiNode, fn: (n: UiNode) => void): void {
  fn(node);
  if (node.kind === "box") {
    for (const c of node.children) walk(c, fn);
  }
}
