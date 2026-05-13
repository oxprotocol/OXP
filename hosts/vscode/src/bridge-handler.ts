/**
 * VS Code bridge handler — routes `oxp:request` messages from extension
 * webviews to actual IDE capabilities (fs, shell, storage, net, etc.).
 *
 * Each webview gets its own bridge handler instance, scoped to the
 * extension's permissions declared in oxp.json.
 */

import * as vscode from "vscode";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as cp from "node:child_process";
import { homedir } from "node:os";

export interface BridgeContext {
  extensionId: string;
  version: string;
  permissions: string[];
  /** Absolute path to the extension's install directory. */
  installDir: string;
  /** VS Code extension context for storage. */
  context: vscode.ExtensionContext;
}

interface BridgeRequest {
  type: "oxp:request";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface BridgeResponse {
  type: "oxp:response";
  id: number;
  result?: unknown;
  error?: string;
}

/**
 * Create a message handler for a webview panel that routes bridge RPC
 * calls to IDE capabilities.
 */
export function createBridgeHandler(
  webview: vscode.Webview,
  ctx: BridgeContext,
): vscode.Disposable {
  const storagePrefix = `oxp:bridge:${ctx.extensionId}:`;

  function hasPermission(capability: string): boolean {
    // Simple permission check — match exact or prefix.
    return ctx.permissions.some(
      (p) => p === capability || capability.startsWith(p + ":"),
    );
  }

  function respond(id: number, result: unknown): void {
    const msg: BridgeResponse = { type: "oxp:response", id, result };
    void webview.postMessage(msg);
  }

  function respondError(id: number, error: string): void {
    const msg: BridgeResponse = { type: "oxp:response", id, error };
    void webview.postMessage(msg);
  }

  async function handleRequest(req: BridgeRequest): Promise<void> {
    const { id, method, params } = req;
    try {
      const result = await dispatch(method, params);
      respond(id, result);
    } catch (err) {
      respondError(id, (err as Error).message || "unknown error");
    }
  }

  async function dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      // ─── filesystem ───────────────────────────────────────────
      case "fs/readFile": {
        if (!hasPermission("fs.read"))
          throw new Error("Permission denied: fs.read");
        const p = resolvePath(params.path as string);
        const bytes = await fsp.readFile(p);
        return { bytes: bytes.toString("base64") };
      }
      case "fs/writeFile": {
        if (!hasPermission("fs.write"))
          throw new Error("Permission denied: fs.write");
        const p = resolvePath(params.path as string);
        const bytes = Buffer.from(params.bytes as string, "base64");
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, bytes);
        return {};
      }
      case "fs/listDir": {
        if (!hasPermission("fs.read"))
          throw new Error("Permission denied: fs.read");
        const p = resolvePath(params.path as string);
        const entries = await fsp.readdir(p);
        return { entries };
      }
      case "fs/stat": {
        if (!hasPermission("fs.read"))
          throw new Error("Permission denied: fs.read");
        const p = resolvePath(params.path as string);
        const stat = await fsp.stat(p);
        return {
          size: stat.size,
          isDir: stat.isDirectory(),
          mtimeMs: stat.mtimeMs,
        };
      }

      // ─── shell ────────────────────────────────────────────────
      case "shell/exec": {
        if (!hasPermission("shell.exec"))
          throw new Error("Permission denied: shell.exec");
        const cmd = params.cmd as string;
        const args = (params.args as string[]) ?? [];
        const cwd =
          (params.cwd as string) ??
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const timeout = (params.timeout as number) ?? 30_000;
        return await execShell(cmd, args, cwd, timeout);
      }

      // ─── storage ──────────────────────────────────────────────
      case "storage/get": {
        const key = params.key as string;
        const v = ctx.context.globalState.get<string>(storagePrefix + key);
        return { value: v ?? null };
      }
      case "storage/set": {
        const key = params.key as string;
        const value = params.value as string;
        await ctx.context.globalState.update(storagePrefix + key, value);
        return {};
      }
      case "storage/delete": {
        const key = params.key as string;
        await ctx.context.globalState.update(storagePrefix + key, undefined);
        return {};
      }
      case "storage/keys": {
        const keys = ctx.context.globalState
          .keys()
          .filter((k) => k.startsWith(storagePrefix))
          .map((k) => k.slice(storagePrefix.length));
        return { keys };
      }

      // ─── network ──────────────────────────────────────────────
      case "net/fetch": {
        if (!hasPermission("net.fetch"))
          throw new Error("Permission denied: net.fetch");
        const url = params.url as string;
        const method = (params.method as string) ?? "GET";
        const headers = (params.headers as [string, string][]) ?? [];
        const bodyB64 = params.body as string | undefined;

        const fetchHeaders: Record<string, string> = {};
        for (const [k, v] of headers) fetchHeaders[k] = v;

        const body = bodyB64 ? Buffer.from(bodyB64, "base64") : undefined;
        const resp = await fetch(url, {
          method,
          headers: fetchHeaders,
          body,
        });
        const respBody = Buffer.from(await resp.arrayBuffer());
        const respHeaders: [string, string][] = [];
        resp.headers.forEach((v, k) => respHeaders.push([k, v]));

        return {
          status: resp.status,
          headers: respHeaders,
          body: respBody.toString("base64"),
        };
      }

      // ─── workspace ────────────────────────────────────────────
      case "workspace/rootPath": {
        const root =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
        return { path: root };
      }
      case "workspace/openFile": {
        const filePath = resolvePath(params.path as string);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const line = params.line as number | undefined;
        const opts: vscode.TextDocumentShowOptions = line
          ? { selection: new vscode.Range(line - 1, 0, line - 1, 0) }
          : {};
        await vscode.window.showTextDocument(doc, opts);
        return {};
      }

      // ─── ui ───────────────────────────────────────────────────
      case "ui/notify": {
        const message = params.message as string;
        const type = (params.type as string) ?? "info";
        if (type === "error") {
          void vscode.window.showErrorMessage(`[${ctx.extensionId}] ${message}`);
        } else if (type === "warn") {
          void vscode.window.showWarningMessage(
            `[${ctx.extensionId}] ${message}`,
          );
        } else {
          void vscode.window.showInformationMessage(
            `[${ctx.extensionId}] ${message}`,
          );
        }
        return {};
      }
      case "ui/getTheme": {
        const kind = vscode.window.activeColorTheme.kind;
        const theme =
          kind === vscode.ColorThemeKind.Dark ||
          kind === vscode.ColorThemeKind.HighContrast
            ? "dark"
            : "light";
        return { theme };
      }

      default:
        throw new Error(`Unknown bridge method: ${method}`);
    }
  }

  /** Resolve a path — relative paths are resolved against workspace root. */
  function resolvePath(p: string): string {
    if (path.isAbsolute(p)) return p;
    const root =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
    return path.resolve(root, p);
  }

  /** Execute a shell command and return stdout/stderr/code. */
  function execShell(
    cmd: string,
    args: string[],
    cwd?: string,
    timeout = 30_000,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = cp.spawn(cmd, args, {
        cwd,
        timeout,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code) =>
        resolve({ code: code ?? 1, stdout, stderr }),
      );
      child.on("error", (err) =>
        resolve({ code: 1, stdout: "", stderr: err.message }),
      );
    });
  }

  // Subscribe to webview messages.
  return webview.onDidReceiveMessage((msg: unknown) => {
    if (
      typeof msg === "object" &&
      msg !== null &&
      (msg as BridgeRequest).type === "oxp:request"
    ) {
      void handleRequest(msg as BridgeRequest);
    }
  });
}

/**
 * Read the compiled oxp-bridge.js script for injection into webviews.
 * Returns the raw JS source that creates `window.oxp`.
 *
 * Resolution order (first hit wins):
 *   1. `dist/oxp-bridge.js` next to the bundled extension — this is the
 *      production path. `esbuild.mjs` copies the SDK build here.
 *   2. The SDK's own dist folder in the monorepo — used during local dev
 *      when the host is run unbundled (or the copy step hasn't run yet).
 *   3. Console-warn stub so missing-bridge failures are loud, not silent.
 */
export function loadBridgeScript(): string {
  const bundledPath = path.join(__dirname, "oxp-bridge.js");
  try {
    if (fs.existsSync(bundledPath)) {
      return fs.readFileSync(bundledPath, "utf-8");
    }
  } catch {
    /* ignore */
  }

  const devPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "sdk",
    "dist",
    "oxp-bridge.js",
  );
  try {
    if (fs.existsSync(devPath)) {
      return fs.readFileSync(devPath, "utf-8");
    }
  } catch {
    /* ignore */
  }

  return "console.warn('OXP bridge not found — oxp.* APIs unavailable');";
}
