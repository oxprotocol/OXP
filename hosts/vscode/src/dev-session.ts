/**
 * One-click dev workflow.
 *
 * `OXP: Start Dev Session` (command id `oxp.devStart`) and the F5 binding
 * call `startDevSession()`. It:
 *
 *   1. Picks the workspace folder containing `oxp.json` (prompts if multiple).
 *   2. Resolves the `oxp` CLI: prefers a workspace-local install
 *      (`node_modules/.bin/oxp`) and falls back to `npx --yes
 *      @oxprotocol/cli@latest` so a fresh checkout still works.
 *   3. Spawns `oxp dev` as a child process inside an OutputChannel,
 *      watching stdout for the `OXP_DEV_READY port=NNNN` handshake line
 *      emitted by `packages/cli/src/commands/dev.ts`.
 *   4. As soon as the port is known, opens a WebSocket to
 *      `ws://localhost:<port>/dev` and renders incoming bundles into the
 *      activity-bar `OxpDevView` (registered separately in extension.ts).
 *
 * No browser. No URL prompts. The extension UI lives inside the IDE, exactly
 * like a normal VS Code activity-bar view.
 *
 * Loud "DEV — signature bypass" badge is preserved.
 */
import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import WebSocket from "ws";
import { decodeDevReload } from "@oxprotocol/host-core";
import type { VerifiedBundle } from "@oxprotocol/host-core";
import { renderMainUi } from "./render";

const DEV_DIR_NAME = "dev-session-view";

/**
 * Path to the shared autostart marker. Written by the "developer" window
 * just before it spawns the EDH window; consumed by the EDH window on
 * activate. Shared dir = `$OXP_HOME/edh` so it survives across IDE
 * processes and forks (Cursor, VS Code, etc).
 */
function edhMarkerPath(): string {
  const home =
    process.env.OXP_HOME ??
    join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".oxp");
  return join(home, "edh", "autostart.json");
}

interface EdhMarker {
  /** Marker schema version. Mismatched versions are ignored. */
  v?: number;
  ts: number;
  folderPath: string;
  /**
   * WebSocket URL of the running `oxp dev` backend. When present the
   * EDH window attaches to this URL directly instead of spawning its
   * own CLI — one CLI per session, no port collisions.
   */
  wsUrl?: string;
  forkBin?: string;
}

const EDH_MARKER_VERSION = 1;

/**
 * Legacy: launch a dedicated EDH window from inside an IDE window when
 * the CLI is not already running. Kept for the case where the user
 * clicks "Start Dev Session" from inside a workspace and there is no
 * CLI yet. The CLI itself is now responsible for spawning the EDH
 * window in the normal `oxp dev` flow.
 */
export async function launchEdhWindow(
  folder: vscode.WorkspaceFolder,
): Promise<void> {
  const marker: EdhMarker = {
    v: EDH_MARKER_VERSION,
    ts: Date.now(),
    folderPath: folder.uri.fsPath,
  };
  const p = edhMarkerPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(marker), "utf8");
  await vscode.commands.executeCommand("vscode.openFolder", folder.uri, {
    forceNewWindow: true,
  });
}

/**
 * Called from `activate()`. If a recent EDH marker matches one of this
 * window's workspace folders, consume it and attach to the running
 * `oxp dev` backend at `marker.wsUrl`. This window does NOT spawn its
 * own CLI — the marker was written by the CLI that owns the session.
 */
export async function autostartEdhIfMarked(
  context: vscode.ExtensionContext,
  view: OxpDevView,
): Promise<boolean> {
  const p = edhMarkerPath();
  if (!existsSync(p)) return false;
  let marker: EdhMarker;
  try {
    marker = JSON.parse(readFileSync(p, "utf8")) as EdhMarker;
  } catch {
    try {
      unlinkSync(p);
    } catch {
      /* noop */
    }
    return false;
  }
  // Ignore markers from a future schema we don't understand.
  if (marker.v != null && marker.v !== EDH_MARKER_VERSION) return false;
  // 60s window — only consume markers that are still hot.
  if (Date.now() - marker.ts > 60_000) {
    try {
      unlinkSync(p);
    } catch {
      /* noop */
    }
    return false;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const match = folders.find((f) => f.uri.fsPath === marker.folderPath);
  if (!match) return false;
  // Consume the marker so other windows don't double-fire. The CLI
  // will write a fresh one on its next session.
  try {
    unlinkSync(p);
  } catch {
    /* noop */
  }
  // Mark this window as the EDH for the rest of its life.
  edhWindow = true;
  if (marker.wsUrl) {
    // Modern path: attach directly to the running CLI's WS — no spawn.
    attachToRunningSession(context, view, match, marker.wsUrl);
  } else {
    // Legacy fallback (older CLI / legacy `launchEdhWindow` path):
    // spawn the CLI here. New flows do not hit this branch.
    await startDevSession(context, view, { folder: match, edh: true });
  }
  return true;
}

/** True iff this VS Code window was opened as an OXP EDH. */
let edhWindow = false;
export function isEdhWindow(): boolean {
  return edhWindow;
}

interface ExtensionCommand {
  command: string;
  title: string;
  category?: string;
}

interface ActiveSession {
  folder: vscode.WorkspaceFolder;
  /** null when this window is attaching to a CLI it doesn't own (EDH mode). */
  proc: ChildProcess | null;
  ws: WebSocket | null;
  output: vscode.OutputChannel;
  port: number | null;
  /** Compact status-bar pill replacing the in-flow "⚠ DEV" banner. */
  status: vscode.StatusBarItem | null;
  /**
   * Set true when the CLI has explicitly told us it's shutting down, so
   * we close this EDH window instead of just dropping to the idle screen.
   */
  shuttingDown: boolean;
  /**
   * Commands the running extension declared via `contributes.commands`
   * — registered as live VS Code commands and exposed through the
   * "OXP Dev: Run Extension Command…" palette entry.
   */
  extensionCommands: ExtensionCommand[];
  /** Disposables for the registered commands above (cleared on each render). */
  extensionCommandDisposables: vscode.Disposable[];
  dispose(): void;
}

let active: ActiveSession | null = null;

/* -------------------------------------------------------------------------- */
/* Sidebar webview view — render target for the running extension's UI.       */
/* -------------------------------------------------------------------------- */

export class OxpDevView implements vscode.WebviewViewProvider {
  public static readonly viewId = "oxp.dev.view";

  private view: vscode.WebviewView | null = null;
  private dirUri: vscode.Uri;
  private lastBundle: VerifiedBundle | null = null;
  private lastDevUrl: string | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.dirUri = vscode.Uri.joinPath(context.globalStorageUri, DEV_DIR_NAME);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.dirUri],
    };
    view.onDidDispose(() => {
      this.view = null;
    });
    // If a session is already running, re-render the extension UI here
    // so the developer sees it the moment they (re)open the view.
    if (this.lastBundle && active?.port != null) {
      void this.render(this.lastBundle, urlForPort(active.port));
    } else {
      view.webview.html = idleHtml();
    }
  }

  setStatus(status: string, accent: "info" | "warn" | "error" = "info"): void {
    if (this.view) this.view.webview.html = statusHtml(status, accent);
  }

  /** Reset the sidebar to the idle screen (called when the session stops). */
  closePanel(): void {
    this.lastBundle = null;
    this.lastDevUrl = null;
    if (this.view) this.view.webview.html = idleHtml();
  }

  async render(bundle: VerifiedBundle, devUrl: string): Promise<void> {
    this.lastBundle = bundle;
    this.lastDevUrl = devUrl;
    try {
      await this.renderInner(bundle, devUrl);
    } catch (err) {
      const message = (err as Error)?.stack ?? String(err);
      if (active?.output) {
        active.output.appendLine(`✖ activation failed:\n${message}`);
      }
      if (this.view) {
        this.view.webview.html = activationErrorHtml(bundle, message);
      }
    }
  }

  private async renderInner(
    bundle: VerifiedBundle,
    devUrl: string,
  ): Promise<void> {
    const uiRel = bundle.manifest.main?.ui;
    if (!uiRel) {
      this.setStatus(
        `${bundle.id}: no main.ui (code-only extension; @oxprotocol/sdk wiring lands in Pillar 4)`,
        "warn",
      );
      return;
    }

    // Wipe + rewrite the dev dir.
    try {
      await vscode.workspace.fs.delete(this.dirUri, { recursive: true });
    } catch {
      /* noop */
    }
    await vscode.workspace.fs.createDirectory(this.dirUri);
    for (const [path, bytes] of bundle.files) {
      const target = vscode.Uri.joinPath(this.dirUri, ...path.split("/"));
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(target, ".."),
      );
      await vscode.workspace.fs.writeFile(target, bytes);
    }

    // Ensure the sidebar view exists. If the developer hasn't clicked
    // the OXP activity-bar icon yet, programmatically focus it so the
    // extension UI is visible the moment the dev session is ready.
    if (!this.view) {
      try {
        await vscode.commands.executeCommand(`${OxpDevView.viewId}.focus`);
      } catch {
        /* noop — best effort */
      }
    }
    if (!this.view) {
      // Still no view (workspace trust, focus race, etc.). The next
      // resolveWebviewView call will pick up `lastBundle` and render.
      return;
    }

    const outcome = await renderMainUi({
      manifest: bundle.manifest,
      resourceRoot: this.dirUri,
      webview: this.view.webview,
      dev: true,
      read: async (rel) =>
        vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(this.dirUri, ...rel.split("/")),
        ),
    });

    if (outcome.kind === "empty") {
      this.setStatus(`${bundle.id}: ${outcome.reason}`, "warn");
      return;
    }

    this.view.title = `${bundle.id}@${bundle.version}`;
    this.view.description = "DEV";
    // The dev/signature-bypass signal now lives in the status bar
    // (compact, persistent) and in the view title strip. We do NOT
    // inject an in-flow banner — that overlay used to dominate the
    // sidebar and obscure the extension's own UI.
    const finalHtml = outcome.html;
    this.view.webview.html = finalHtml;

    // Status bar pill: warning-coloured "$(beaker) OXP DEV — id@ver".
    // Click reveals the Output channel so the user can find logs fast.
    if (active) {
      const s =
        active.status ??
        vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      s.text = `$(beaker) OXP DEV — ${bundle.id}@${bundle.version}`;
      s.tooltip = new vscode.MarkdownString(
        `**OXP dev session**\n\n` +
          `\`${bundle.id}@${bundle.version}\`\n\n` +
          `Backend: \`${devUrl}\`\n\n` +
          `Signature verification is **bypassed** for the duration of\n` +
          `\`oxp dev\`. Click to open the Output channel.`,
      );
      s.command = "oxp.devShowOutput";
      s.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
      s.show();
      active.status = s;
    }

    // Forward in-webview console errors and uncaught exceptions back to
    // the host's Output channel so the developer can see runtime
    // failures without opening Webview DevTools. Author-side
    // `console.log/info/warn` are NOT piped — those still belong in
    // DevTools (Output would drown).
    this.view.webview.onDidReceiveMessage((m: unknown) => {
      if (!active?.output) return;
      if (!m || typeof m !== "object") return;
      const obj = m as {
        kind?: unknown;
        level?: unknown;
        message?: unknown;
        stack?: unknown;
      };
      if (obj.kind === "oxp:dev:log") {
        const level =
          obj.level === "error" || obj.level === "warn" ? obj.level : "log";
        const text = typeof obj.message === "string" ? obj.message : "";
        active.output.appendLine(`[webview ${level}] ${text}`);
        return;
      }
      if (obj.kind === "oxp:dev:error") {
        const message =
          typeof obj.message === "string" ? obj.message : String(obj.message);
        const stack = typeof obj.stack === "string" ? obj.stack : "";
        active.output.appendLine(
          `[webview error] ${message}${stack ? `\n${stack}` : ""}`,
        );
        active.output.show(true);
        return;
      }
      if (obj.kind === "oxp:cap:invoke") {
        // Capability bridge for ui-v1 HTML extensions running in dev.
        // Routes a small set of read-only host operations from the React
        // UI (sandboxed webview) to VS Code APIs, gated by the bundle's
        // declared `fs.read*` / `workspace.read` permissions and the
        // workspace folder. See packages/sdk hostBridge() helper.
        void this.handleCapabilityInvoke(obj as never, bundle);
        return;
      }
    });

    // Register the extension's declared commands (contributes.commands)
    // so they're invokable from VS Code's "OXP Dev: Run Extension
    // Command…" palette entry. Disposed and re-registered on every
    // render so live edits to the manifest pick up immediately.
    registerExtensionCommands(bundle);

    // Dev diagnostics: log what we just rendered + what's in the bundle.
    // Lets us debug "empty webview" issues without dev-tools spelunking.
    if (active?.output) {
      const o = active.output;
      o.appendLine(
        `▸ rendered ${bundle.id}@${bundle.version} into webview view (${finalHtml.length} bytes)`,
      );
      const fileList = Array.from(bundle.files.keys()).slice(0, 20);
      o.appendLine(`  bundle files: ${fileList.join(", ")}`);
      const uiRel = bundle.manifest.main?.ui;
      if (uiRel) o.appendLine(`  main.ui: ${uiRel}`);
    }

    try {
      this.view.show?.(true);
    } catch {
      /* noop */
    }
  }

  private setRunningStatus(bundle: VerifiedBundle, devUrl: string): void {
    if (!this.view) return;
    this.view.webview.html = runningHtml(bundle, devUrl);
  }

  /**
   * Capability bridge — webview UI ⇄ VS Code APIs.
   *
   * Dev-mode only. Honours these read-only capabilities:
   *   - `fs.read`  : read a workspace-relative file path
   *   - `fs.list`  : list a workspace-relative directory
   *   - `fs.stat`  : stat a workspace-relative path
   *   - `workspace.root` : returns the absolute workspace folder uri
   *
   * The bundle MUST declare a matching `fs.read*` permission. Path
   * traversal (`..`, absolute paths) is rejected. Production install
   * gates the same operations through the regular permission broker;
   * this bridge is only wired for the EDH webview during dev iteration.
   */
  private async handleCapabilityInvoke(
    msg: {
      kind: "oxp:cap:invoke";
      id?: unknown;
      capability?: unknown;
      args?: unknown;
    },
    bundle: VerifiedBundle,
  ): Promise<void> {
    const id = typeof msg.id === "string" ? msg.id : null;
    const capability = typeof msg.capability === "string" ? msg.capability : "";
    const args = (msg.args ?? {}) as { path?: unknown };

    const reply = (ok: boolean, payload: Record<string, unknown>): void => {
      if (!this.view || id == null) return;
      this.view.webview.postMessage({
        kind: "oxp:cap:result",
        id,
        ok,
        ...payload,
      });
    };

    try {
      const root =
        active?.folder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) {
        return reply(false, { error: "no workspace folder open" });
      }

      if (capability === "workspace.root") {
        return reply(true, { value: { path: root.fsPath } });
      }

      const declared = (bundle.manifest.permissions ?? []) as readonly string[];
      const hasFsRead = declared.some(
        (p) => p === "fs.read" || p.startsWith("fs.read:"),
      );

      if (
        capability === "fs.read" ||
        capability === "fs.list" ||
        capability === "fs.stat"
      ) {
        if (!hasFsRead) {
          return reply(false, {
            error: `extension did not declare 'fs.read' in oxp.json#permissions`,
          });
        }
        const rel = typeof args.path === "string" ? args.path : "";
        if (!rel || rel.startsWith("/") || rel.includes("..")) {
          return reply(false, {
            error: `invalid path '${rel}' (must be a workspace-relative path with no '..')`,
          });
        }
        const target = vscode.Uri.joinPath(root, ...rel.split("/"));

        if (capability === "fs.read") {
          const bytes = await vscode.workspace.fs.readFile(target);
          // Webviews can't ship binary cleanly; base64-encode.
          const b64 = Buffer.from(bytes).toString("base64");
          return reply(true, { value: { bytes: b64, size: bytes.byteLength } });
        }
        if (capability === "fs.list") {
          const entries = await vscode.workspace.fs.readDirectory(target);
          return reply(true, {
            value: {
              entries: entries.map(([name, kind]) => ({
                name,
                kind:
                  kind === vscode.FileType.Directory
                    ? "dir"
                    : kind === vscode.FileType.File
                      ? "file"
                      : "other",
              })),
            },
          });
        }
        if (capability === "fs.stat") {
          const s = await vscode.workspace.fs.stat(target);
          return reply(true, {
            value: {
              size: s.size,
              mtimeMs: s.mtime,
              isDir: (s.type & vscode.FileType.Directory) !== 0,
            },
          });
        }
      }

      return reply(false, {
        error: `unsupported capability '${capability}'`,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      reply(false, {
        error: e.message ?? String(err),
        code: e.code,
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Command: oxp.devStart                                                      */
/* -------------------------------------------------------------------------- */

export async function startDevSession(
  context: vscode.ExtensionContext,
  view: OxpDevView,
  opts: { folder?: vscode.WorkspaceFolder; edh?: boolean } = {},
): Promise<void> {
  if (active) {
    const stop = "Stop";
    const choice = await vscode.window.showInformationMessage(
      `OXP dev session is already running in ${active.folder.name}.`,
      stop,
      "Show Output",
    );
    if (choice === stop) active.dispose();
    else if (choice === "Show Output") active.output.show();
    return;
  }

  const folder = opts.folder ?? (await pickProjectFolder());
  if (!folder) return;

  // The CLI is the single source of truth for the EDH lifecycle. When
  // invoked from a workspace window (no `opts.edh`), we spawn `oxp dev`
  // *here* and the CLI itself drops the EDH marker + opens a fresh IDE
  // window of the same fork. That new window's host extension reads the
  // marker and attaches to this CLI's WebSocket. Net result: one CLI,
  // two windows (developer / EDH), works uniformly across every VS Code
  // fork because we drive each fork's bundled CLI (`<bin> -n <folder>`).
  const isAttachedEdh = !!opts.edh;

  const output = vscode.window.createOutputChannel(
    `OXP Dev: ${folder.name}`,
    "log",
  );
  output.show(true);
  output.appendLine(`▸ starting oxp dev in ${folder.uri.fsPath}`);

  const cli = resolveCliCommand(folder.uri.fsPath);
  output.appendLine(`▸ ${cli.label}`);

  const proc = spawn(cli.command, cli.args, {
    cwd: folder.uri.fsPath,
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const session: ActiveSession = {
    folder,
    proc,
    ws: null,
    output,
    port: null,
    status: null,
    shuttingDown: false,
    extensionCommands: [],
    extensionCommandDisposables: [],
    dispose() {
      try {
        this.ws?.close();
      } catch {
        /* noop */
      }
      try {
        if (this.proc && !this.proc.killed) this.proc.kill("SIGINT");
      } catch {
        /* noop */
      }
      this.status?.dispose();
      this.status = null;
      for (const d of this.extensionCommandDisposables) {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      }
      this.extensionCommandDisposables = [];
      this.extensionCommands = [];
      active = null;
      view.closePanel();
      view.setStatus("Dev session stopped.", "info");
      output.appendLine("▸ session stopped");
    },
  };
  active = session;

  view.setStatus(`Starting oxp dev in ${folder.name}…`);

  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");

  let stdoutBuf = "";
  proc.stdout?.on("data", (chunk: string) => {
    output.append(chunk);
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      const m = line.match(/OXP_DEV_READY\s+port=(\d+)/);
      if (m && session.port == null) {
        session.port = Number(m[1]);
        // Only attach a WebSocket here in the legacy in-window EDH
        // mode. In the normal flow the CLI spawns a separate IDE
        // window which attaches — this window just streams logs.
        if (isAttachedEdh) attachWebSocket(session, view);
        else
          view.setStatus(
            `Dev backend ready on port ${session.port} — Extension Development Host opening…`,
          );
      }
    }
  });
  proc.stderr?.on("data", (chunk: string) => output.append(chunk));

  proc.on("exit", (code, signal) => {
    output.appendLine(
      `▸ oxp dev exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    );
    if (active === session) {
      view.setStatus(
        `oxp dev exited (code ${code ?? "null"}). See output for details.`,
        code === 0 ? "info" : "error",
      );
      active = null;
    }
  });

  proc.on("error", (err) => {
    output.appendLine(`✖ failed to spawn oxp dev: ${err.message}`);
    view.setStatus(`Failed to start: ${err.message}`, "error");
    if (active === session) active = null;
  });

  context.subscriptions.push({ dispose: () => active?.dispose() });
}

export function stopDevSession(): void {
  if (!active) {
    void vscode.window.showInformationMessage("No OXP dev session is running.");
    return;
  }
  active.dispose();
}

export function showDevOutput(): void {
  if (active?.output) active.output.show(true);
  else
    void vscode.window.showInformationMessage(
      "No OXP dev session is running in this window.",
    );
}

/**
 * Pop a QuickPick of the running extension's declared commands so the
 * developer can fire any of them by name. The static palette entry
 * `oxp.dev.runCommand` routes here — VS Code requires palette commands
 * to be declared in `package.json` at install time, so we use a single
 * dispatcher rather than a synthetic-contribution hack.
 */
export async function pickAndRunExtensionCommand(): Promise<void> {
  if (!active) {
    void vscode.window.showInformationMessage(
      "No OXP dev session is running in this window.",
    );
    return;
  }
  const cmds = active.extensionCommands;
  if (cmds.length === 0) {
    void vscode.window.showInformationMessage(
      "The running extension hasn't declared any `contributes.commands`.",
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    cmds.map((c) => ({
      label: c.category ? `${c.category}: ${c.title}` : c.title,
      description: c.command,
      cmd: c,
    })),
    {
      title: "OXP Dev: run extension command",
      placeHolder: "Pick a command to send to the running extension",
      matchOnDescription: true,
    },
  );
  if (!pick) return;
  await runExtensionCommand(pick.cmd.command);
}

/** Parse + (re)register the extension's contributes.commands. */
function registerExtensionCommands(bundle: VerifiedBundle): void {
  if (!active) return;
  // Dispose previous registrations first — manifest may have changed.
  for (const d of active.extensionCommandDisposables) {
    try {
      d.dispose();
    } catch {
      /* noop */
    }
  }
  active.extensionCommandDisposables = [];
  active.extensionCommands = [];

  const contributes = (
    bundle.manifest as { contributes?: { commands?: unknown } }
  ).contributes;
  const raw = contributes?.commands;
  if (!Array.isArray(raw)) return;

  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      command?: unknown;
      title?: unknown;
      category?: unknown;
    };
    const command = typeof e.command === "string" ? e.command.trim() : "";
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!command || !title) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    const category =
      typeof e.category === "string" && e.category.trim()
        ? e.category.trim()
        : undefined;
    const decl: ExtensionCommand = category
      ? { command, title, category }
      : { command, title };
    active.extensionCommands.push(decl);
    // Register the command live so any keybinding, task, or other
    // extension can invoke it programmatically. Errors are swallowed
    // because VS Code throws if the same id was already registered in
    // this window (another reload, hot-edit, etc.) — the dispose loop
    // above already handled the happy path.
    try {
      const disp = vscode.commands.registerCommand(command, () =>
        runExtensionCommand(command),
      );
      active.extensionCommandDisposables.push(disp);
    } catch (err) {
      active.output.appendLine(
        `\u26a0 could not register command "${command}": ${(err as Error).message}`,
      );
    }
  }
  if (active.extensionCommands.length > 0) {
    active.output.appendLine(
      `\u25b8 registered ${active.extensionCommands.length} extension command(s): ` +
        active.extensionCommands.map((c) => c.command).join(", "),
    );
  }
}

/** Forward a command invocation to the running extension over the WS. */
async function runExtensionCommand(command: string): Promise<void> {
  if (!active?.ws || active.ws.readyState !== WebSocket.OPEN) {
    void vscode.window.showWarningMessage(
      `OXP Dev: cannot run "${command}" — no live connection to the extension.`,
    );
    return;
  }
  try {
    active.ws.send(JSON.stringify({ kind: "command", id: command }));
    active.output.appendLine(`\u25b8 \u2192 command ${command}`);
  } catch (err) {
    active.output.appendLine(
      `\u2716 failed to send command ${command}: ${(err as Error).message}`,
    );
  }
}

/**
 * EDH attach mode: this window connects to an existing `oxp dev`
 * backend (URL from the EDH marker) without spawning a CLI of its own.
 * This is the production path \u2014 see `packages/cli/src/lib/edh-marker.ts`.
 */
function attachToRunningSession(
  context: vscode.ExtensionContext,
  view: OxpDevView,
  folder: vscode.WorkspaceFolder,
  wsUrl: string,
): void {
  if (active) {
    active.output.appendLine(
      `\u26a0 ignoring EDH attach \u2014 a session is already active in this window`,
    );
    return;
  }
  let port: number | null = null;
  try {
    port = Number(new URL(wsUrl).port) || null;
  } catch {
    /* noop */
  }
  const output = vscode.window.createOutputChannel(
    `OXP Dev: ${folder.name}`,
    "log",
  );
  output.appendLine(`\u25b8 EDH attach: ${wsUrl}`);

  const session: ActiveSession = {
    folder,
    proc: null,
    ws: null,
    output,
    port,
    status: null,
    shuttingDown: false,
    extensionCommands: [],
    extensionCommandDisposables: [],
    dispose() {
      try {
        this.ws?.close();
      } catch {
        /* noop */
      }
      this.status?.dispose();
      this.status = null;
      for (const d of this.extensionCommandDisposables) {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      }
      this.extensionCommandDisposables = [];
      this.extensionCommands = [];
      active = null;
      view.closePanel();
      view.setStatus("Dev session detached.", "info");
      output.appendLine("\u25b8 detached");
    },
  };
  active = session;
  view.setStatus(`Connecting to ${wsUrl}\u2026`);
  attachWebSocket(session, view);
  context.subscriptions.push({ dispose: () => active?.dispose() });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function attachWebSocket(session: ActiveSession, view: OxpDevView): void {
  if (session.port == null) return;
  const url = urlForPort(session.port);
  const wsUrl = url.replace(/^http/, "ws") + "/dev";
  session.output.appendLine(`▸ attaching to ${wsUrl}`);
  view.setStatus(`Connecting to ${url}…`);

  const ws = new WebSocket(wsUrl);
  session.ws = ws;

  ws.on("open", () => {
    session.output.appendLine("▸ ws open — waiting for first reload");
    view.setStatus("Connected, waiting for first build…");
  });
  ws.on("error", (err) => {
    session.output.appendLine(`✖ ws error: ${(err as Error).message}`);
  });
  ws.on("close", () => {
    session.output.appendLine("▸ ws closed");
  });
  ws.on("message", async (raw: Buffer | string) => {
    let msg: { kind: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw.toString()) as typeof msg;
    } catch {
      return;
    }
    if (msg.kind === "error") {
      view.setStatus(`Pack failed: ${String(msg.message ?? "")}`, "error");
      return;
    }
    if (msg.kind === "shutdown") {
      // The CLI is exiting (user hit Ctrl+C in `oxp dev`). Close this
      // EDH window so we don't leave a zombie — VS Code's own F5 does
      // the same when the parent debugger detaches.
      session.shuttingDown = true;
      session.output.appendLine(
        "▸ CLI announced shutdown — closing EDH window",
      );
      try {
        await vscode.commands.executeCommand("workbench.action.closeWindow");
      } catch {
        // Fall back to clearing the view if the close command isn't
        // available (e.g. running inside an integrated terminal window).
        session.dispose();
      }
      return;
    }
    if (msg.kind !== "reload") return;
    try {
      const bundle = await decodeDevReload(
        msg as unknown as Parameters<typeof decodeDevReload>[0],
      );
      await view.render(bundle, url);
    } catch (err) {
      view.setStatus(`Decode failed: ${(err as Error).message}`, "error");
    }
  });
}

function urlForPort(port: number): string {
  return `http://localhost:${port}`;
}

async function pickProjectFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const candidates = findOxpProjects();
  if (candidates.length === 0) {
    void vscode.window.showErrorMessage(
      "No oxp.json found in this workspace (looked one level deep). Open your extension folder, or its parent.",
    );
    return undefined;
  }
  if (candidates.length === 1) return candidates[0];
  const pick = await vscode.window.showQuickPick(
    candidates.map((f) => ({
      label: f.name,
      description: f.uri.fsPath,
      folder: f,
    })),
    { title: "OXP: pick the extension folder to run" },
  );
  return pick?.folder;
}

/**
 * Find every OXP project reachable from open workspace folders.
 *
 * We accept three layouts so users don't have to think about it:
 *   1. The workspace folder itself contains `oxp.json` (the common case).
 *   2. A direct subfolder contains `oxp.json` (monorepo / project parent
 *      open — e.g. user opened `Mobile-Development/` and the extension
 *      lives in `Mobile-Development/my-ext/`).
 *
 * We deliberately do NOT recurse deeper to keep this fast and avoid
 * finding `node_modules/**\/oxp.json` or unrelated nested projects.
 */
export function findOxpProjects(): vscode.WorkspaceFolder[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const out: vscode.WorkspaceFolder[] = [];
  for (const f of folders) {
    const root = f.uri.fsPath;
    if (existsSync(join(root, "oxp.json"))) {
      out.push(f);
      continue;
    }
    // One level deep.
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const sub = join(root, name);
      try {
        if (!statSync(sub).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(sub, "oxp.json"))) {
        out.push({
          uri: vscode.Uri.file(sub),
          name,
          index: f.index,
        });
      }
    }
  }
  return out;
}

interface CliCommand {
  command: string;
  args: string[];
  label: string;
}

function resolveCliCommand(cwd: string): CliCommand {
  // The CLI always auto-launches the EDH window — there is no flag to
  // disable it. The host extension is a pure attach client.
  // 1. Workspace-local install (preferred).
  const localBin = join(cwd, "node_modules", ".bin", "oxp");
  if (existsSync(localBin)) {
    return {
      command: localBin,
      args: ["dev"],
      label: `${localBin} dev`,
    };
  }
  // 2. Fall back to npx — works on a fresh clone with zero ceremony.
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", "@oxprotocol/cli@latest", "dev"],
    label: `npx --yes @oxprotocol/cli@latest dev`,
  };
}

/* -------------------------------------------------------------------------- */
/* HTML templates                                                             */
/* -------------------------------------------------------------------------- */

function idleHtml(): string {
  return `<!doctype html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:1rem;line-height:1.5;font-size:12px">
    <h3 style="margin:0 0 .75rem;font-size:13px">OXP Dev</h3>
    <p style="margin:0 0 .75rem;opacity:.85">No dev session running in this window.</p>
    <p style="margin:0 0 .5rem"><strong>To launch your extension:</strong></p>
    <ul style="margin:0 0 1rem;padding-left:1.1rem;opacity:.85">
      <li>Click the green ▶ above, or</li>
      <li>Command Palette → <strong>OXP: Start Dev Session</strong>, or</li>
      <li>Press <strong>F5</strong> in any file of the project</li>
    </ul>
    <div style="border:1px solid var(--vscode-panel-border);border-radius:4px;padding:.6rem .7rem;opacity:.85">
      <p style="margin:0 0 .25rem"><strong>↗ A new window will open</strong></p>
      <p style="margin:0">It's the <em>Extension Development Host</em> — your extension runs there. This window stays as your editor.</p>
    </div>
  </body></html>`;
}

function statusHtml(
  message: string,
  accent: "info" | "warn" | "error",
): string {
  const colors: Record<typeof accent, string> = {
    info: "var(--vscode-descriptionForeground)",
    warn: "var(--vscode-editorWarning-foreground)",
    error: "var(--vscode-errorForeground)",
  };
  return `<!doctype html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:1rem;line-height:1.5">
    <h3 style="margin:0 0 .75rem">OXP Dev</h3>
    <p style="margin:0;color:${colors[accent]}">${escapeHtml(message)}</p>
  </body></html>`;
}

function runningHtml(bundle: VerifiedBundle, devUrl: string): string {
  return `<!doctype html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:1rem;line-height:1.5;font-size:12px">
    <h3 style="margin:0 0 .75rem;font-size:13px">OXP Dev — running</h3>
    <p style="margin:0 0 .25rem"><strong>${escapeHtml(bundle.id)}</strong>@${escapeHtml(bundle.version)}</p>
    <p style="margin:0 0 1rem;opacity:.75">backend: <code>${escapeHtml(devUrl)}</code></p>

    <div style="border:1px solid var(--vscode-panel-border);border-radius:4px;padding:.6rem .7rem;margin-bottom:1rem">
      <p style="margin:0 0 .35rem"><strong>↗ Your extension opened in an editor tab</strong></p>
      <p style="margin:0;opacity:.8">Look at the tab labelled <code>OXP DEV · ${escapeHtml(bundle.id)}</code> at the top of the editor. That's where your UI runs.</p>
    </div>

    <p style="margin:0 0 .35rem;opacity:.85"><strong>What you do here:</strong></p>
    <ul style="margin:0 0 1rem;padding-left:1.1rem;opacity:.85">
      <li>Edit your <code>src/</code> files and save — the tab hot-reloads.</li>
      <li>Click the red ■ in the toolbar above to stop the session.</li>
      <li>Closed the tab by accident? Click the green ▶ to bring it back.</li>
    </ul>

    <p style="margin:0;opacity:.55;font-size:11px">The red <code>⚠ DEV</code> banner is a reminder that signature verification is bypassed during dev. It disappears when you publish a real, signed build.</p>
  </body></html>`;
}

function activationErrorHtml(bundle: VerifiedBundle, message: string): string {
  return `<!doctype html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:1rem;line-height:1.5;font-size:12px">
    <h3 style="margin:0 0 .5rem;font-size:13px;color:var(--vscode-errorForeground)">Activation failed</h3>
    <p style="margin:0 0 .75rem;opacity:.85"><strong>${escapeHtml(bundle.id)}</strong>@${escapeHtml(bundle.version)} could not be rendered.</p>
    <pre style="margin:0;padding:.6rem .7rem;background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-panel-border);border-radius:4px;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.45;overflow:auto;max-height:60vh">${escapeHtml(message)}</pre>
    <p style="margin:.75rem 0 0;opacity:.65;font-size:11px">Fix the error and save — the dev server will hot-reload this view.</p>
  </body></html>`;
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
