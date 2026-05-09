/**
 * @oxprotocol/ui/dom — host-side DOM renderer.
 *
 * Walks a UiTree and produces sandboxed HTML for embedding in a host
 * webview (e.g. VS Code). All text values are HTML-escaped. Buttons emit
 * a `data-oxp-action` attribute that the host page-script wires to a
 * postMessage call back into the extension.
 *
 * Pure string output — no DOM dependency. Safe to call in any environment.
 */

import type {
  UiBoxNode,
  UiButtonNode,
  UiCodeBlockNode,
  UiNode,
  UiStackNode,
  UiTextNode,
  UiTree,
  UiVirtualListNode,
} from "@oxprotocol/types";
import { validateTree } from "./index.js";

export interface RenderOptions {
  /** Optional CSS prefix to scope class names. Default `oxp-`. */
  classPrefix?: string;
}

/**
 * Render a tree to a self-contained HTML fragment + a small <style> block.
 * Throws if the tree contains an unknown node kind.
 */
export function renderTreeToHtml(
  tree: UiTree,
  opts: RenderOptions = {},
): string {
  const err = validateTree(tree);
  if (err) throw new Error(`@oxprotocol/ui/dom: invalid tree: ${err}`);
  const ctx: Ctx = { p: opts.classPrefix ?? "oxp-" };
  const body = Array.isArray(tree)
    ? tree.map((n) => renderNode(n, ctx)).join("")
    : renderNode(tree, ctx);
  return `<style>${baseStyles(ctx.p)}</style><div class="${ctx.p}root">${body}</div>`;
}

interface Ctx {
  p: string;
}

function renderNode(node: UiNode, ctx: Ctx): string {
  switch (node.kind) {
    case "box":
      return renderBox(node, ctx);
    case "stack":
      return renderStack(node, ctx);
    case "text":
      return renderText(node, ctx);
    case "button":
      return renderButton(node, ctx);
    case "virtual-list":
      return renderVirtualList(node, ctx);
    case "code":
      return renderCode(node, ctx);
  }
}

function renderBox(n: UiBoxNode, ctx: Ctx): string {
  const cls = [
    `${ctx.p}box`,
    n.pad !== undefined ? `${ctx.p}pad-${n.pad}` : "",
    n.gap !== undefined ? `${ctx.p}gap-${n.gap}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="${cls}">${(n.children ?? []).map((c) => renderNode(c, ctx)).join("")}</div>`;
}

function renderStack(n: UiStackNode, ctx: Ctx): string {
  const axis = n.axis ?? "vertical";
  const cls = [
    `${ctx.p}stack`,
    `${ctx.p}stack-${axis}`,
    n.gap !== undefined ? `${ctx.p}gap-${n.gap}` : "",
    n.align ? `${ctx.p}align-${n.align}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="${cls}">${(n.children ?? []).map((c) => renderNode(c, ctx)).join("")}</div>`;
}

function renderText(n: UiTextNode, ctx: Ctx): string {
  const v = n.variant ?? "body";
  const tag = v === "heading" ? "h2" : v === "code" ? "code" : "span";
  return `<${tag} class="${ctx.p}text ${ctx.p}text-${v}">${escape(n.value)}</${tag}>`;
}

function renderButton(n: UiButtonNode, ctx: Ctx): string {
  const variant = n.variant ?? "primary";
  const disabled = n.disabled ? " disabled" : "";
  return `<button type="button" class="${ctx.p}btn ${ctx.p}btn-${variant}" data-oxp-action="${escapeAttr(n.action)}"${disabled}>${escape(n.label)}</button>`;
}

function renderVirtualList(n: UiVirtualListNode, ctx: Ctx): string {
  const rh = n.rowHeight ?? 28;
  // V1 host renderer does not yet virtualise; emit a scrollable container
  // with a fixed row height. Authors get the right semantics; perf comes
  // when the Piye native renderer ships.
  const rows = n.items
    .map(
      (item) =>
        `<div class="${ctx.p}vlist-row" style="height:${rh}px">${renderNode(item, ctx)}</div>`,
    )
    .join("");
  return `<div class="${ctx.p}vlist" data-row-height="${rh}">${rows}</div>`;
}

function renderCode(n: UiCodeBlockNode, ctx: Ctx): string {
  const lang = n.language ? ` data-lang="${escapeAttr(n.language)}"` : "";
  return `<pre class="${ctx.p}codeblock"${lang}><code>${escape(n.value)}</code></pre>`;
}

// ──────────────────────────────────────────────────────────────────────
// Styles & escaping
// ──────────────────────────────────────────────────────────────────────

function baseStyles(p: string): string {
  // Spacing scale follows UiSpacing values 0,1,2,3,4,6,8 (×4px).
  const spaces = [0, 1, 2, 3, 4, 6, 8];
  const padRules = spaces
    .map((s) => `.${p}pad-${s}{padding:${s * 4}px}`)
    .join("");
  const gapRules = spaces.map((s) => `.${p}gap-${s}{gap:${s * 4}px}`).join("");
  return `
.${p}root{font:13px system-ui,sans-serif;color:inherit}
.${p}box{display:flex;flex-direction:column}
.${p}stack{display:flex}
.${p}stack-vertical{flex-direction:column}
.${p}stack-horizontal{flex-direction:row}
.${p}align-start{align-items:flex-start}
.${p}align-center{align-items:center}
.${p}align-end{align-items:flex-end}
.${p}align-stretch{align-items:stretch}
${padRules}
${gapRules}
.${p}text-heading{font-size:18px;font-weight:600;margin:0}
.${p}text-caption{font-size:11px;opacity:0.7}
.${p}text-code,code.${p}text{font-family:ui-monospace,Menlo,monospace}
.${p}btn{padding:4px 10px;border-radius:4px;border:1px solid var(--vscode-button-border,transparent);cursor:pointer;font:inherit}
.${p}btn-primary{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}
.${p}btn-secondary{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#fff)}
.${p}btn-ghost{background:transparent;color:inherit}
.${p}btn-danger{background:#a1260d;color:#fff}
.${p}btn:disabled{opacity:0.5;cursor:not-allowed}
.${p}vlist{overflow-y:auto;max-height:400px;border:1px solid var(--vscode-panel-border,#3c3c3c);border-radius:4px}
.${p}vlist-row{padding:0 8px;display:flex;align-items:center;border-bottom:1px solid var(--vscode-panel-border,#3c3c3c20)}
.${p}codeblock{background:var(--vscode-textCodeBlock-background,#1e1e1e);padding:8px;border-radius:4px;overflow-x:auto;margin:0}
.${p}codeblock code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
`.trim();
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escape(s);
}
