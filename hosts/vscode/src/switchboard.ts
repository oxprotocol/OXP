/**
 * OXP Switchboard — the management panel inside the OXP host sidebar.
 *
 * Shows all installed OXP extensions as a list with toggle switches.
 * Toggle state is delegated entirely to ExplorerSlotManager, which
 * allocates Explorer sidebar slots and sets VS Code context keys so
 * extensions appear / disappear instantly without a window reload.
 */

import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { Store, InstalledRecord } from "@oxprotocol/host-core";
import type { ExplorerSlotManager } from "./explorer-slots";

export class SwitchboardView implements vscode.WebviewViewProvider {
  static readonly viewId = "oxp.switchboard.view";

  private view: vscode.WebviewView | null = null;

  constructor(
    private readonly store: Store,
    private readonly slots: ExplorerSlotManager,
  ) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.title = "Extensions";

    view.onDidDispose(() => {
      this.view = null;
    });

    view.webview.onDidReceiveMessage(async (msg: unknown) => {
      const m = msg as { type: string; id: string; visible: boolean };
      if (m.type === "toggle") {
        await this.slots.setVisible(m.id, m.visible);
        await this.render();
      }
    });

    await this.render();
  }

  /** Re-render after store changes (new install, etc.). */
  async refresh(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    if (!this.view) return;
    let records: InstalledRecord[] = [];
    try {
      records = await this.store.list();
    } catch {
      /* store not ready */
    }
    const nonce = randomBytes(16).toString("base64url");
    this.view.webview.html = buildHtml(records, this.slots, nonce);
  }
}

function buildHtml(
  records: InstalledRecord[],
  slots: ExplorerSlotManager,
  nonce: string,
): string {
  const items = records
    .map((r) => {
      const visible = slots.isVisible(r.id);
      const name = esc(r.manifest.displayName ?? r.id);
      const id = esc(r.id);
      const ver = esc(r.version);
      const hasUi = !!r.manifest.main?.ui;
      const chk = visible ? " checked" : "";
      const toggle = hasUi
        ? `<label class="toggle" title="${visible ? "Hide from Explorer" : "Pin to Explorer"}">
            <input type="checkbox" class="sr" data-id="${id}"${chk} />
            <span class="track"><span class="thumb"></span></span>
          </label>`
        : `<span class="badge">code-only</span>`;
      return `<div class="row">
  <div class="info">
    <span class="name">${name}</span>
    <span class="meta">${id}&nbsp;·&nbsp;v${ver}</span>
  </div>
  <div class="ctl">${toggle}</div>
</div>`;
    })
    .join("\n");

  const empty =
    records.length === 0
      ? `<div class="empty">
  <div class="ei">⊡</div>
  <p>No extensions installed</p>
  <p class="hint">Run <code>oxp install @publisher/slug</code><br>from a terminal to get started.</p>
</div>`
      : "";

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'nonce-${nonce}'">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);color:var(--vscode-foreground);background:transparent}
.head{padding:8px 12px 4px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));opacity:.7;user-select:none}
.row{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--vscode-sideBar-border,rgba(128,128,128,.12))}
.row:hover{background:var(--vscode-list-hoverBackground)}
.info{flex:1;min-width:0}
.name{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{display:block;font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.ctl{flex-shrink:0}
.toggle{display:flex;align-items:center;cursor:pointer}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.track{display:block;width:30px;height:16px;border-radius:8px;background:var(--vscode-input-border,rgba(128,128,128,.4));position:relative;transition:background .14s}
.thumb{display:block;width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.7);position:absolute;top:3px;left:3px;transition:transform .14s,background .14s}
input:checked~.track{background:var(--vscode-button-background,#0e639c)}
input:checked~.track .thumb{transform:translateX(14px);background:#fff}
.badge{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.6;border:1px solid currentColor;border-radius:3px;padding:1px 5px}
.empty{padding:28px 16px;text-align:center;color:var(--vscode-descriptionForeground)}
.ei{font-size:28px;margin-bottom:10px;opacity:.35}
.empty p{font-size:12px;line-height:1.6}
.hint{font-size:11px;margin-top:8px;opacity:.7}
code{font-family:var(--vscode-editor-font-family);font-size:11px;background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));padding:1px 4px;border-radius:2px}
</style>
</head><body>
<div class="head">Installed</div>
${items}${empty}
<script nonce="${nonce}">(function(){
  var vsc=acquireVsCodeApi();
  document.addEventListener('change',function(e){
    var cb=e.target;
    if(!cb||cb.type!=='checkbox')return;
    var id=cb.dataset.id;
    if(id)vsc.postMessage({type:'toggle',id:id,visible:cb.checked});
  });
})();</script>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;",
  );
}
