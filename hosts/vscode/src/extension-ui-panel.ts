/**
 * Per-instance webview that renders `oxp-ui-v1` trees pushed by the
 * Rust runtime via `host/ui-render`.
 *
 * Each loaded extension instance gets at most one panel. Subsequent
 * renders reuse the same webview and reconcile by replacing the tree
 * (no virtual DOM — tree size is small, full HTML rebuild is fine).
 *
 * User input is shipped back as `extension/event` notifications carrying
 * a `UiEvent` JSON payload; `runtime-rpc-service.sendEvent` does the
 * actual wire write.
 */

import * as vscode from "vscode";
import type { RuntimeRpcService, UiRenderEvent } from "./runtime-rpc-service";

export class ExtensionUiPanel {
  private static panels = new Map<string, ExtensionUiPanel>();
  private readonly disposables: vscode.Disposable[] = [];

  static showOrUpdate(svc: RuntimeRpcService, ev: UiRenderEvent): void {
    let p = ExtensionUiPanel.panels.get(ev.instanceId);
    if (!p) {
      const panel = vscode.window.createWebviewPanel(
        "oxpExtensionUi",
        ev.extensionId || ev.instanceId,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      p = new ExtensionUiPanel(panel, svc, ev.instanceId, ev.extensionId);
      ExtensionUiPanel.panels.set(ev.instanceId, p);
    }
    p.render(ev.treeJson);
  }

  /** Drop the webview for an instance (e.g. on deactivate/unload). */
  static close(instanceId: string): void {
    const p = ExtensionUiPanel.panels.get(instanceId);
    if (p) p.panel.dispose();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly svc: RuntimeRpcService,
    private readonly instanceId: string,
    extensionId: string,
  ) {
    panel.title = extensionId || instanceId;
    panel.webview.html = this.html();
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage(
      (m: { type: string; [k: string]: unknown }) => {
        // Forward the user interaction straight to the wasm side as a
        // UiEvent payload. The wasm component decodes the JSON in its
        // ui-handler.on-event implementation.
        if (m.type === "ui-event") {
          this.svc.sendEvent(this.instanceId, m.event ?? {});
        }
      },
      null,
      this.disposables,
    );
  }

  private render(treeJson: string): void {
    this.panel.webview.postMessage({ type: "render", treeJson });
    if (this.panel.viewColumn === undefined) {
      this.panel.reveal(undefined, true);
    }
  }

  private html(): string {
    // The webview is a thin renderer — it just walks UiNode JSON and
    // produces matching DOM. Node ids round-trip back as event targets.
    return /* html */ `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; margin: 0; }
  .oxp-text-xs  { font-size: 11px; }
  .oxp-text-sm  { font-size: 12px; }
  .oxp-text-md  { font-size: 14px; }
  .oxp-text-lg  { font-size: 18px; }
  .oxp-text-bold { font-weight: 600; }
  .oxp-color-muted  { opacity: 0.7; }
  .oxp-color-error  { color: var(--vscode-errorForeground); }
  .oxp-color-accent { color: var(--vscode-textLink-foreground); }
  .oxp-divider { height: 1px; background: var(--vscode-panel-border); margin: 6px 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  input, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 4px 6px; border-radius: 2px; font: inherit; }
  label.oxp-cb { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
</style>
</head>
<body>
  <div id="root"></div>
<script>
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  function send(event) {
    vscode.postMessage({ type: "ui-event", event });
  }

  function build(node) {
    if (!node || typeof node !== "object") {
      return document.createTextNode("");
    }
    switch (node.kind) {
      case "box": {
        const el = document.createElement("div");
        el.style.display = "flex";
        el.style.flexDirection = node.layout === "row" ? "row" : "column";
        el.style.gap = (node.gap ?? 6) + "px";
        if (node.padding) el.style.padding = node.padding + "px";
        if (node.id) el.dataset.id = node.id;
        for (const c of node.children ?? []) el.appendChild(build(c));
        return el;
      }
      case "text": {
        const el = document.createElement("span");
        el.textContent = String(node.content ?? "");
        if (node.size)   el.classList.add("oxp-text-" + node.size);
        if (node.weight === "bold") el.classList.add("oxp-text-bold");
        if (node.color) {
          if (/^#/.test(node.color)) el.style.color = node.color;
          else el.classList.add("oxp-color-" + node.color);
        }
        return el;
      }
      case "button": {
        const el = document.createElement("button");
        el.textContent = String(node.label ?? "");
        if (node.variant === "secondary") el.classList.add("secondary");
        if (node.disabled) el.disabled = true;
        el.addEventListener("click", () => send({ type: "click", id: node.id }));
        return el;
      }
      case "input": {
        const el = document.createElement("input");
        el.type = node.secret ? "password" : "text";
        if (node.value !== undefined)        el.value = String(node.value);
        if (node.placeholder !== undefined)  el.placeholder = String(node.placeholder);
        el.addEventListener("input", () => send({ type: "input", id: node.id, value: el.value }));
        return el;
      }
      case "select": {
        const el = document.createElement("select");
        for (const o of node.options ?? []) {
          const opt = document.createElement("option");
          opt.value = String(o.value);
          opt.textContent = String(o.label);
          if (node.value === o.value) opt.selected = true;
          el.appendChild(opt);
        }
        el.addEventListener("change", () => send({ type: "input", id: node.id, value: el.value }));
        return el;
      }
      case "checkbox": {
        const wrap = document.createElement("label");
        wrap.className = "oxp-cb";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!node.checked;
        cb.addEventListener("change", () => send({ type: "input", id: node.id, value: cb.checked ? "true" : "false" }));
        wrap.appendChild(cb);
        const lbl = document.createElement("span");
        lbl.textContent = String(node.label ?? "");
        wrap.appendChild(lbl);
        return wrap;
      }
      case "divider": {
        const el = document.createElement("div");
        el.className = "oxp-divider";
        return el;
      }
      case "spacer": {
        const el = document.createElement("div");
        el.style.height = (node.size ?? 8) + "px";
        return el;
      }
      default: {
        const el = document.createElement("div");
        el.textContent = "[unknown node kind: " + String(node.kind) + "]";
        return el;
      }
    }
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "render") {
      let tree;
      try { tree = JSON.parse(m.treeJson); }
      catch (err) {
        root.innerHTML = "";
        const pre = document.createElement("pre");
        pre.textContent = "Invalid UI tree: " + (err && err.message ? err.message : err);
        root.appendChild(pre);
        return;
      }
      root.innerHTML = "";
      root.appendChild(build(tree));
    }
  });
</script>
</body>
</html>`;
  }

  private dispose(): void {
    ExtensionUiPanel.panels.delete(this.instanceId);
    for (const d of this.disposables) d.dispose();
  }
}
