/**
 * Host-side WebviewViewProvider that wrappers ask for.
 *
 * The "native extension" UX works like this: when an OXP extension is
 * installed, the CLI also installs a tiny *wrapper VSIX* whose
 * package.json contributes its own `viewsContainer` + view (with the
 * extension's own icon). The wrapper's `extension.js` doesn't render
 * anything itself — it just acquires the OXP host extension's exported
 * API and calls `createWebviewProvider(extensionId)` to get the actual
 * rendering implementation.
 *
 * That implementation lives here. It looks the record up in the store,
 * wires the bridge so `window.oxp.*` works, and renders the extension's
 * `main.ui` HTML inside the wrapper's webview view.
 *
 * Nothing in this file knows about, or interacts with, the dev panel.
 */

import * as vscode from "vscode";
import type { Store, InstalledRecord } from "@oxprotocol/host-core";
import { renderMainUi } from "./render";
import { createBridgeHandler, loadBridgeScript } from "./bridge-handler";
import { extractPermissionStrings } from "./permissions";

export class WrapperWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private bridgeDisposable: vscode.Disposable | null = null;

  constructor(
    private readonly extensionId: string,
    private readonly store: Store,
    private readonly context: vscode.ExtensionContext,
  ) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.onDidDispose(() => {
      this.bridgeDisposable?.dispose();
      this.bridgeDisposable = null;
      this.view = null;
    });

    let record: InstalledRecord | undefined;
    try {
      record = (await this.store.get(this.extensionId)) ?? undefined;
    } catch (err) {
      view.webview.html = errorHtml(this.extensionId, (err as Error).message);
      return;
    }
    if (!record) {
      view.webview.html = errorHtml(
        this.extensionId,
        "Extension is not installed in the OXP store.",
      );
      return;
    }

    const resourceRoot = vscode.Uri.parse(this.store.resourcePath(record));
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot],
    };
    view.title = record.manifest.displayName ?? record.id;
    view.description = `v${record.version}`;

    const permissions = extractPermissionStrings(record.manifest.permissions);
    this.bridgeDisposable = createBridgeHandler(view.webview, {
      extensionId: record.id,
      version: record.version,
      permissions,
      installDir: resourceRoot.fsPath,
      context: this.context,
    });

    const outcome = await renderMainUi({
      manifest: record.manifest,
      resourceRoot,
      webview: view.webview,
      read: async (rel) =>
        vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(resourceRoot, ...rel.split("/")),
        ),
      trusted: true,
    });

    if (outcome.kind === "empty") {
      view.webview.html = errorHtml(record.id, outcome.reason);
      return;
    }

    view.webview.html = injectBridge(outcome.html, outcome.nonce, record);
  }
}

function injectBridge(html: string, nonce: string, record: InstalledRecord): string {
  const bridgeJs = loadBridgeScript();
  const bootstrap = `
<script nonce="${nonce}">
  (function() {
    var vscode = acquireVsCodeApi();
    window.__vscode = vscode;
    window.__oxp_extension_id = ${JSON.stringify(record.id)};
    window.__oxp_extension_version = ${JSON.stringify(record.version)};
  })();
</script>
<script nonce="${nonce}">${bridgeJs}</script>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${bootstrap}</head>`);
  }
  return bootstrap + html;
}

function errorHtml(extensionId: string, reason: string): string {
  const safe = (s: string) =>
    s.replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
    );
  return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<style>
  body { margin:0;padding:24px 16px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font-size:12px;line-height:1.5 }
  .id { color:var(--vscode-descriptionForeground);margin:0 0 12px;font-size:11px }
  .reason { background:var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));border-left:3px solid var(--vscode-editorWarning-foreground);padding:8px 10px;white-space:pre-wrap }
</style>
</head><body>
<p class="id">${safe(extensionId)}</p>
<div class="reason">${safe(reason)}</div>
</body></html>`;
}
