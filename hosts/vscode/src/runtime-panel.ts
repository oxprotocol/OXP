/**
 * "OXP Runtime" webview panel — the human-visible result.
 *
 * Mirrors the JetBrains ToolWindow: status header, list of loaded
 * extensions, install button (file picker), and a hello.greet REPL
 * that round-trips through the Rust runtime + wasm component.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  fetchBundle,
  FetchBundleError,
  listUrlInstalls,
} from "@oxprotocol/host-core";
import type { RuntimeRpcService } from "./runtime-rpc-service";
import { promptForPermissions } from "./permission-prompt";

export class RuntimePanel {
  private static current?: RuntimePanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(
    svc: RuntimeRpcService,
    context: vscode.ExtensionContext,
  ): RuntimePanel {
    if (RuntimePanel.current) {
      RuntimePanel.current.panel.reveal();
      return RuntimePanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "oxpRuntime",
      "OXP Runtime",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    RuntimePanel.current = new RuntimePanel(panel, svc, context);
    return RuntimePanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly svc: RuntimeRpcService,
    private readonly context: vscode.ExtensionContext,
  ) {
    panel.webview.html = this.html();
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage(
      (m) => this.onMessage(m),
      null,
      this.disposables,
    );
    this.disposables.push(svc.onDidChange(() => this.pushStatus()));
    // Push initial status once webview is ready.
    setTimeout(() => this.pushStatus(), 100);
  }

  private async onMessage(msg: {
    type: string;
    [k: string]: unknown;
  }): Promise<void> {
    try {
      switch (msg.type) {
        case "start":
          await this.svc.ensureStarted();
          this.log("✓ runtime ready");
          break;
        case "pickAndLoad": {
          const file = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            filters: { wasm: ["wasm"] },
          });
          if (!file?.[0]) return;
          await this.installAndActivate(file[0].fsPath);
          break;
        }
        case "installFromUrl": {
          await this.installFromUrlInteractive();
          break;
        }
        case "pickFromCli": {
          await this.pickAndActivateUrlInstall();
          break;
        }
        case "greet": {
          const inst = String(msg.instanceId ?? "").trim();
          const name = String(msg.name ?? "world").trim() || "world";
          if (!inst) {
            this.log("✗ no instance — install one first");
            return;
          }
          this.log(`→ ${inst} hello.greet name=${name}`);
          const out = await this.svc.command(inst, "hello.greet", { name });
          this.log(`← ${out}`);
          break;
        }
        case "deactivate": {
          const inst = String(msg.instanceId ?? "").trim();
          if (!inst) return;
          await this.svc.deactivate(inst);
          await this.svc.unload(inst);
          this.log(`✓ removed ${inst}`);
          break;
        }
      }
    } catch (e) {
      this.log(`✗ ${(e as Error).message}`);
    }
  }

  /**
   * Shared install path for both the picker and the URL flow.
   * Runs the permission prompt, calls `extension/load`, then
   * `extension/activate`, and reports to the panel webview.
   */
  async installAndActivate(
    componentPath: string,
    opts: { extensionId?: string; sourceLabel?: string } = {},
  ): Promise<void> {
    const name =
      componentPath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.wasm$/, "") ?? "extension";
    const extensionId = opts.extensionId ?? `@local/${name}`;
    const grants = await promptForPermissions({ extensionId });
    if (grants === undefined) {
      this.log("✗ install cancelled (no permissions chosen)");
      return;
    }
    const src = opts.sourceLabel ?? componentPath;
    this.log(
      `→ loading ${src}` +
        (grants.length
          ? ` (granted: ${grants.join(", ")})`
          : " (no extra permissions)"),
    );
    const res = await this.svc.load(
      extensionId,
      "0.0.0",
      componentPath,
      grants,
    );
    await this.svc.activate(res.instanceId);
    this.log(`✓ activated ${res.instanceId}`);
    this.panel.webview.postMessage({
      type: "instanceLoaded",
      instanceId: res.instanceId,
    });
  }

  /** Prompt for a URL, fetch it, then run the standard install flow. */
  async installFromUrlInteractive(prefill?: string): Promise<void> {
    const url = await vscode.window.showInputBox({
      title: "Install OXP extension from URL",
      prompt:
        "Paste an https:// (or file://) URL to a .wasm component. http:// is allowed for localhost only.",
      placeHolder:
        "https://registry.oxp.dev/@aldgar/hello/0.2.0/extension.wasm",
      value: prefill,
      ignoreFocusOut: true,
      validateInput: (v) => {
        if (!v) return "Required";
        try {
          // eslint-disable-next-line no-new
          new URL(v);
          return null;
        } catch {
          return "Not a valid URL";
        }
      },
    });
    if (!url) return;
    await this.installFromUrl(url);
  }

  /**
   * QuickPick over previously CLI-installed URL bundles
   * ($OXP_HOME/host-store/url-installs/). Lets users activate without
   * re-pasting the URL or re-downloading.
   */
  async pickAndActivateUrlInstall(): Promise<void> {
    const root = path.join(
      process.env.OXP_HOME ?? path.join(os.homedir(), ".oxp"),
      "host-store",
    );
    const records = await listUrlInstalls(root);
    if (records.length === 0) {
      vscode.window.showInformationMessage(
        "No URL installs yet. Run `oxp install-url <https://…wasm>` to populate the shared store.",
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      records.map((r) => ({
        label: r.suggestedId,
        description: `${(r.size / 1024).toFixed(1)} KiB · ${r.installedAt.slice(0, 10)}`,
        detail: r.sourceUrl,
        record: r,
      })),
      {
        title: "Activate a URL-installed extension",
        placeHolder: "Pick a bundle to load into the runtime",
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!pick) return;
    await this.installAndActivate(pick.record.bundlePath, {
      extensionId: pick.record.suggestedId,
      sourceLabel: pick.record.sourceUrl,
    });
  }

  /** Non-interactive entry point used by the `oxp.installFromUrl` command. */
  async installFromUrl(rawUrl: string): Promise<void> {
    const parsed = new URL(rawUrl);
    const allowInsecureHttp =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1");

    const cacheDir = path.join(os.homedir(), ".oxp", "cache", "url-installs");

    try {
      const fetched = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading ${rawUrl}`,
          cancellable: false,
        },
        async (progress) => {
          let lastPct = -1;
          return await fetchBundle(rawUrl, {
            cacheDir,
            allowInsecureHttp,
            onProgress: (received, total) => {
              if (total) {
                const pct = Math.floor((received / total) * 100);
                if (pct !== lastPct) {
                  progress.report({
                    message: `${pct}% (${received}/${total} bytes)`,
                  });
                  lastPct = pct;
                }
              } else {
                progress.report({ message: `${received} bytes…` });
              }
            },
          });
        },
      );

      this.log(
        `↓ downloaded ${fetched.size} bytes, sha256 ${fetched.sha256.slice(0, 12)}…`,
      );

      const extName =
        parsed.pathname
          .split("/")
          .pop()
          ?.replace(/\.wasm$/, "") ?? "remote";
      await this.installAndActivate(fetched.componentPath, {
        extensionId: `@url/${extName}`,
        sourceLabel: rawUrl,
      });
    } catch (e) {
      if (e instanceof FetchBundleError) {
        this.log(`✗ download failed (${e.code}): ${e.message}`);
        vscode.window.showErrorMessage(`OXP install failed: ${e.message}`);
      } else {
        throw e;
      }
    }
  }

  private pushStatus(): void {
    this.panel.webview.postMessage({
      type: "status",
      running: this.svc.running,
      pid: this.svc.pid ?? null,
      runtimeVersion: this.svc.initResult?.runtimeVersion ?? null,
      wasmEngine: this.svc.initResult?.wasmEngine ?? null,
      instances: this.svc.loadedInstances,
    });
  }

  private log(line: string): void {
    this.panel.webview.postMessage({ type: "log", line });
  }

  private html(): string {
    return /* html */ `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  h2 { margin-top: 16px; margin-bottom: 6px; font-size: 13px; text-transform: uppercase; opacity: 0.7; }
  .status { padding: 8px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .row { display: flex; gap: 6px; margin: 4px 0; align-items: center; }
  label { min-width: 70px; font-size: 12px; }
  input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 4px 6px; border-radius: 2px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  ul { margin: 4px 0; padding-left: 18px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  pre { background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); padding: 8px; border-radius: 4px; height: 220px; overflow: auto; font-family: var(--vscode-editor-font-family); font-size: 12px; margin: 0; }
</style>
</head>
<body>
  <h2>Runtime</h2>
  <div class="status" id="status">not started</div>
  <div class="row">
    <button id="start">Start runtime</button>
    <button class="secondary" id="install">Install .wasm…</button>
    <button class="secondary" id="installUrl">Install from URL…</button>
    <button class="secondary" id="pickFromCli">From CLI…</button>
  </div>

  <h2>Loaded extensions</h2>
  <ul id="instances"><li><em>none</em></li></ul>

  <h2>Run hello.greet</h2>
  <div class="row"><label>Instance:</label><input id="inst" placeholder="ext-…" /></div>
  <div class="row"><label>name arg:</label><input id="name" value="vscode" /></div>
  <div class="row">
    <button id="run">Send hello.greet</button>
    <button class="secondary" id="remove">Deactivate + unload</button>
  </div>

  <h2>Output</h2>
  <pre id="out"></pre>

<script>
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const out = $("out");

  function appendLog(line) {
    out.textContent += line + "\\n";
    out.scrollTop = out.scrollHeight;
  }

  $("start").onclick = () => vscode.postMessage({ type: "start" });
  $("install").onclick = () => vscode.postMessage({ type: "pickAndLoad" });
  $("installUrl").onclick = () => vscode.postMessage({ type: "installFromUrl" });
  $("pickFromCli").onclick = () => vscode.postMessage({ type: "pickFromCli" });
  $("run").onclick = () => vscode.postMessage({
    type: "greet",
    instanceId: $("inst").value,
    name: $("name").value,
  });
  $("remove").onclick = () => vscode.postMessage({
    type: "deactivate",
    instanceId: $("inst").value,
  });

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "log") appendLog(m.line);
    if (m.type === "instanceLoaded") $("inst").value = m.instanceId;
    if (m.type === "status") {
      $("status").textContent = m.running
        ? \`v\${m.runtimeVersion} · \${m.wasmEngine} · pid \${m.pid}\`
        : "not started";
      const ul = $("instances");
      ul.innerHTML = m.instances.length
        ? m.instances.map((i) => \`<li><code>\${i}</code></li>\`).join("")
        : "<li><em>none</em></li>";
    }
  });
</script>
</body>
</html>`;
  }

  private dispose(): void {
    RuntimePanel.current = undefined;
    for (const d of this.disposables) d.dispose();
  }
}
