/**
 * @oxprotocol/ui — frozen V1 component vocabulary.
 *
 * Authors build a UI tree by composing these factories:
 *
 *     import { Stack, Text, Button } from "@oxprotocol/ui";
 *
 *     export default defineExtension({
 *       renderTree() {
 *         return Stack({ gap: 2 }, [
 *           Text("Hello", { variant: "heading" }),
 *           Button({ label: "Run", action: "run" }),
 *         ]);
 *       },
 *     });
 *
 * The vocabulary is intentionally small. New nodes require a spec bump.
 * Hosts that understand `ui.components: "oxp-ui-v1"` may render natively
 * (Piye) or via `@oxprotocol/ui/dom` (VS Code webview).
 */

import type {
  UiBoxNode,
  UiButtonNode,
  UiCodeBlockNode,
  UiNode,
  UiSpacing,
  UiStackNode,
  UiTextNode,
  UiTextVariant,
  UiButtonVariant,
  UiVirtualListNode,
} from "@oxprotocol/types";

export type {
  UiAlign,
  UiBoxNode,
  UiButtonNode,
  UiButtonVariant,
  UiCodeBlockNode,
  UiNode,
  UiSpacing,
  UiStackNode,
  UiTextNode,
  UiTextVariant,
  UiTree,
  UiVirtualListNode,
} from "@oxprotocol/types";

// ──────────────────────────────────────────────────────────────────────
// Factories
// ──────────────────────────────────────────────────────────────────────

export interface BoxProps {
  pad?: UiSpacing;
  gap?: UiSpacing;
}

export function Box(props: BoxProps = {}, children: UiNode[] = []): UiBoxNode {
  return { kind: "box", ...props, children };
}

export interface StackProps {
  axis?: "vertical" | "horizontal";
  gap?: UiSpacing;
  align?: UiStackNode["align"];
}

export function Stack(
  props: StackProps = {},
  children: UiNode[] = [],
): UiStackNode {
  return { kind: "stack", ...props, children };
}

export interface TextProps {
  variant?: UiTextVariant;
}

export function Text(value: string, props: TextProps = {}): UiTextNode {
  return { kind: "text", value, ...props };
}

export interface ButtonProps {
  label: string;
  action: string;
  variant?: UiButtonVariant;
  disabled?: boolean;
}

export function Button(props: ButtonProps): UiButtonNode {
  return { kind: "button", ...props };
}

export interface VirtualListProps {
  items: UiNode[];
  rowHeight?: number;
}

export function VirtualList(props: VirtualListProps): UiVirtualListNode {
  return { kind: "virtual-list", ...props };
}

export interface CodeBlockProps {
  value: string;
  language?: string;
}

export function CodeBlock(props: CodeBlockProps): UiCodeBlockNode {
  return { kind: "code", ...props };
}

// ──────────────────────────────────────────────────────────────────────
// Validation (used by `oxp pack` static analyser and host-side guards)
// ──────────────────────────────────────────────────────────────────────

const KINDS = new Set<UiNode["kind"]>([
  "box",
  "stack",
  "text",
  "button",
  "virtual-list",
  "code",
]);

/**
 * Returns the first invalid node found, or `null` if the tree is sound.
 * Used by `@oxprotocol/ui/dom` and by the `oxp pack` static analyser to refuse
 * publishing a bundle whose `renderTree()` returns a non-V1 node.
 */
export function validateTree(node: unknown, path = "$"): string | null {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const err = validateTree(node[i], `${path}[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (!node || typeof node !== "object") {
    return `${path}: expected UiNode object, got ${typeof node}`;
  }
  const k = (node as { kind?: unknown }).kind;
  if (typeof k !== "string" || !KINDS.has(k as UiNode["kind"])) {
    return `${path}.kind: unknown component "${String(k)}"`;
  }
  // recurse into children for container kinds
  if (k === "box" || k === "stack") {
    const children = (node as UiBoxNode).children;
    if (children !== undefined) {
      const err = validateTree(children, `${path}.children`);
      if (err) return err;
    }
  }
  if (k === "virtual-list") {
    const items = (node as UiVirtualListNode).items;
    const err = validateTree(items, `${path}.items`);
    if (err) return err;
  }
  return null;
}
