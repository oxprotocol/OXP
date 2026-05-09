/**
 * VS Code host dev client.
 *
 * Connects to an `oxp dev` server, hot-reloads the webview on every rebuild.
 * Bundles are unpacked to a per-session temp dir under globalStorage so
 * the existing webview localResourceRoots model keeps working.
 *
 * Loud "DEV: signature bypass" badge in the panel title.
 */
import * as vscode from "vscode";
import WebSocket from "ws";
import { decodeDevReload } from "@oxprotocol/host-core";
import type { VerifiedBundle } from "@oxprotocol/host-core";
import { renderMainUi } from "./render";

const DEV_DIR_NAME = "dev-session";

interface DevSession {
  url: string;
  ws: WebSocket;
  panel: vscode.WebviewPanel;
  /** Per-session writable dir we unpack into. Reset on each reload. */
  dirUri: vscode.Uri;
  dispose(): void;
}

let active: DevSession | null = null;

export async function devCommand(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (active) {
    const stop = "Stop";
    const choice = await vscode.window.showInformationMessage(
      `OXP dev already attached to ${active.url}`,
      stop,
    );
    if (choice === stop) active.dispose();
    return;
  }

  const httpUrl = await vscode.window.showInputBox({
    title: "OXP: Attach to dev server",
    prompt: "URL of `oxp dev`",
    value: "http://localhost:7373",
    validateInput: (v) =>
      /^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(v) ? null : "http(s)://host:port",
  });
  if (!httpUrl) return;

  const wsUrl = httpUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/dev";

  const dirUri = vscode.Uri.joinPath(context.globalStorageUri, DEV_DIR_NAME);
  await vscode.workspace.fs.createDirectory(dirUri);

  const panel = vscode.window.createWebviewPanel(
    "oxp.dev",
    "OXP DEV ⚠ signature bypass",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [dirUri],
      retainContextWhenHidden: true,
    },
  );

  const ws = new WebSocket(wsUrl);
  active = {
    url: httpUrl,
    ws,
    panel,
    dirUri,
    dispose() {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      try {
        panel.dispose();
      } catch {
        /* noop */
      }
      active = null;
    },
  };

  panel.onDidDispose(() => active?.dispose());

  ws.on("open", () => {
    panel.webview.html = devLoadingHtml(httpUrl, "connected, waiting…");
  });
  ws.on("error", (err) => {
    panel.webview.html = devLoadingHtml(
      httpUrl,
      `ws error: ${(err as Error).message}`,
    );
  });
  ws.on("close", () => {
    if (active) panel.webview.html = devLoadingHtml(httpUrl, "disconnected");
  });
  ws.on("message", async (raw) => {
    let msg: { kind: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw.toString()) as typeof msg;
    } catch {
      return;
    }
    if (msg.kind === "error") {
      panel.webview.html = devLoadingHtml(
        httpUrl,
        `pack failed: ${String(msg.message ?? "")}`,
      );
      return;
    }
    if (msg.kind !== "reload") return;

    try {
      const bundle = await decodeDevReload(
        msg as unknown as Parameters<typeof decodeDevReload>[0],
      );
      await renderDev(active!, bundle);
    } catch (err) {
      panel.webview.html = devLoadingHtml(
        httpUrl,
        `decode failed: ${(err as Error).message}`,
      );
    }
  });
}

async function renderDev(
  session: DevSession,
  bundle: VerifiedBundle,
): Promise<void> {
  const uiRel = bundle.manifest.main?.ui;
  if (!uiRel) {
    session.panel.webview.html = devLoadingHtml(
      session.url,
      `${bundle.id}: no main.ui (code-only extension; @oxprotocol/sdk wiring lands in Pillar 4)`,
    );
    return;
  }

  // Wipe + rewrite the dev dir.
  try {
    await vscode.workspace.fs.delete(session.dirUri, { recursive: true });
  } catch {
    /* noop */
  }
  await vscode.workspace.fs.createDirectory(session.dirUri);
  for (const [path, bytes] of bundle.files) {
    const target = vscode.Uri.joinPath(session.dirUri, ...path.split("/"));
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(target, ".."),
    );
    await vscode.workspace.fs.writeFile(target, bytes);
  }

  const outcome = await renderMainUi({
    manifest: bundle.manifest,
    resourceRoot: session.dirUri,
    webview: session.panel.webview,
    read: async (rel) =>
      vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(session.dirUri, ...rel.split("/")),
      ),
  });

  if (outcome.kind === "empty") {
    session.panel.webview.html = devLoadingHtml(
      session.url,
      `${bundle.id}: ${outcome.reason}`,
    );
    return;
  }

  session.panel.title = `⚠ DEV ${bundle.id}@${bundle.version}`;
  session.panel.webview.html = withDevBadge(outcome.html, bundle, session.url);
}

function devLoadingHtml(devUrl: string, status: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;background:#1a0a0a;color:#fff;padding:2rem">
    <div style="background:#7f1d1d;color:#fff;padding:.5rem 1rem;border-radius:4px;font-weight:600;margin-bottom:1rem">
      ⚠ OXP DEV — signature bypass
    </div>
    <h2>Waiting for oxp dev…</h2>
    <p><code>${escapeHtml(devUrl)}</code></p>
    <p style="opacity:.7">${escapeHtml(status)}</p>
  </body></html>`;
}

function withDevBadge(
  html: string,
  bundle: VerifiedBundle,
  devUrl: string,
): string {
  const badge = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#7f1d1d;color:#fff;font-family:ui-monospace,monospace;font-size:11px;padding:4px 10px;text-align:center;letter-spacing:.04em">
    ⚠ OXP DEV — signature bypass — ${escapeHtml(bundle.id)}@${escapeHtml(bundle.version)} via ${escapeHtml(devUrl)}
  </div>`;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${badge}`);
  }
  return badge + html;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

// Mirror of extension.ts rewriteAssetUrls — removed; both paths now use
// `./render.ts` (renderMainUi).
