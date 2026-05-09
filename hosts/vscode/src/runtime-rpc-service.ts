/**
 * VS Code adapter that drives the Rust `oxp-runtime` subprocess.
 *
 * This is a parallel track to the existing in-process jco runtime — it lets
 * us run `wasm32-wasip2` components built with the canonical toolchain
 * (cargo build --target wasm32-wasip2) without going through jco transpile.
 * One day the jco path goes away; until then both coexist behind separate
 * commands (`oxp.runtime.*`).
 */

import * as vscode from "vscode";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, platform, arch } from "node:os";
import { RpcClient } from "./rpc-client";

export interface InitializeResult {
  protocolVersion: string;
  runtimeVersion: string;
  wasmEngine: string;
  supportedWorlds: string[];
}

export interface LoadResult {
  instanceId: string;
  exports: string[];
  degraded: string[];
}

export interface UiRenderEvent {
  instanceId: string;
  extensionId: string;
  /** UTF-8 JSON of a `UiNode` tree (see packages/types/src/ui-tree.ts). */
  treeJson: string;
}

export interface UiStatusEvent {
  instanceId: string;
  extensionId: string;
  text: string;
  tooltip?: string | null;
}

export interface UiNotifyEvent {
  instanceId: string;
  extensionId: string;
  message: string;
  buttons: string[];
}

export class RuntimeRpcService implements vscode.Disposable {
  private proc?: ChildProcessWithoutNullStreams;
  private rpc?: RpcClient;
  private starting?: Promise<RpcClient>;
  private _initResult?: InitializeResult;
  private readonly instances = new Set<string>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private readonly _onUiRender = new vscode.EventEmitter<UiRenderEvent>();
  readonly onUiRender = this._onUiRender.event;
  private readonly _onUiStatus = new vscode.EventEmitter<UiStatusEvent>();
  readonly onUiStatus = this._onUiStatus.event;
  private readonly _onUiNotify = new vscode.EventEmitter<UiNotifyEvent>();
  readonly onUiNotify = this._onUiNotify.event;

  constructor(private readonly channel: vscode.OutputChannel) {}

  get initResult(): InitializeResult | undefined {
    return this._initResult;
  }
  get pid(): number | undefined {
    return this.proc?.pid;
  }
  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }
  get loadedInstances(): string[] {
    return [...this.instances];
  }

  /** Returns the cached client or starts the runtime. Idempotent. */
  async ensureStarted(): Promise<RpcClient> {
    if (this.rpc && this.running) return this.rpc;
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async start(): Promise<RpcClient> {
    const binary = await resolveRuntimeBinary();
    this.channel.appendLine(`[runtime] starting ${binary}`);
    const proc = spawn(binary, ["--host", "vscode"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, OXP_LOG: process.env.OXP_LOG ?? "info" },
    });
    this.proc = proc;

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/))
        if (line) this.channel.appendLine(`[oxp-runtime] ${line}`);
    });
    proc.on("exit", (code, signal) => {
      this.channel.appendLine(`[runtime] exited code=${code} signal=${signal}`);
      this.proc = undefined;
      this.rpc = undefined;
      this._initResult = undefined;
      this.instances.clear();
      this._onDidChange.fire();
    });

    const rpc = new RpcClient(proc);
    this.rpc = rpc;

    // Route runtime-initiated notifications (host/ui-render et al.) into
    // typed VS Code events so panels can subscribe without knowing JSON-RPC.
    rpc.onNotification((method, params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      switch (method) {
        case "host/ui-render":
          this._onUiRender.fire({
            instanceId: String(p.instanceId ?? ""),
            extensionId: String(p.extensionId ?? ""),
            treeJson: String(p.treeJson ?? ""),
          });
          break;
        case "host/ui-status":
          this._onUiStatus.fire({
            instanceId: String(p.instanceId ?? ""),
            extensionId: String(p.extensionId ?? ""),
            text: String(p.text ?? ""),
            tooltip: (p.tooltip as string | null | undefined) ?? null,
          });
          break;
        case "host/ui-notify":
          this._onUiNotify.fire({
            instanceId: String(p.instanceId ?? ""),
            extensionId: String(p.extensionId ?? ""),
            message: String(p.message ?? ""),
            buttons: Array.isArray(p.buttons) ? (p.buttons as string[]) : [],
          });
          break;
        default:
          this.channel.appendLine(`[runtime] unhandled notification ${method}`);
      }
    });

    const init = await rpc.request<InitializeResult>(
      "initialize",
      {
        protocolVersion: "1.0",
        host: {
          id: "vscode",
          version: vscode.version,
          platform: `${platform()}-${arch()}`,
        },
        capabilities: { ui: { notification: true, statusBar: true } },
        hostStorePath: join(homedir(), ".oxp", "host-store"),
      },
      15_000,
    );
    this._initResult = init;
    this.channel.appendLine(
      `[runtime] initialized v${init.runtimeVersion} engine=${init.wasmEngine}`,
    );
    this._onDidChange.fire();
    return rpc;
  }

  async load(
    extensionId: string,
    version: string,
    bundlePath: string,
    permissions: string[] = [],
  ): Promise<LoadResult> {
    const rpc = await this.ensureStarted();
    const res = await rpc.request<LoadResult>("extension/load", {
      extensionId,
      version,
      bundlePath: resolve(bundlePath),
      permissions,
    });
    this.instances.add(res.instanceId);
    this._onDidChange.fire();
    return res;
  }

  async activate(instanceId: string): Promise<void> {
    const rpc = await this.ensureStarted();
    await rpc.request("extension/activate", { instanceId });
  }

  async deactivate(instanceId: string): Promise<void> {
    const rpc = await this.ensureStarted();
    await rpc.request("extension/deactivate", { instanceId });
  }

  async unload(instanceId: string): Promise<void> {
    const rpc = await this.ensureStarted();
    rpc.notify("extension/unload", { instanceId });
    this.instances.delete(instanceId);
    this._onDidChange.fire();
  }

  async command(
    instanceId: string,
    commandId: string,
    args: unknown,
  ): Promise<string> {
    const rpc = await this.ensureStarted();
    const res = await rpc.request<{ resultJson: string }>("extension/command", {
      instanceId,
      commandId,
      argsJson: JSON.stringify(args),
    });
    return res.resultJson;
  }

  /** Push a UI event (click/input/submit) back into a wasm component. */
  sendEvent(instanceId: string, payload: unknown): void {
    if (!this.rpc) return;
    this.rpc.notify("extension/event", {
      instanceId,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }

  async dispose(): Promise<void> {
    const rpc = this.rpc;
    const proc = this.proc;
    if (rpc) {
      try {
        await rpc.request("shutdown", null, 2_000);
      } catch {
        /* best effort */
      }
      try {
        rpc.notify("exit");
      } catch {
        /* best effort */
      }
      rpc.closeStdin();
    }
    if (proc && proc.exitCode === null) {
      await new Promise<void>((res) => {
        const t = setTimeout(() => {
          proc.kill("SIGKILL");
          res();
        }, 2_000);
        proc.once("exit", () => {
          clearTimeout(t);
          res();
        });
      });
    }
    this._onDidChange.dispose();
    this._onUiRender.dispose();
    this._onUiStatus.dispose();
    this._onUiNotify.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* Binary resolution                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Find the `oxp-runtime` binary. Checks (in order):
 *   1. `OXP_RUNTIME` env (absolute path)
 *   2. VS Code setting `oxp.runtimePath`
 *   3. `<repo>/runtime/target/release/oxp-runtime` (dev workflow)
 *   4. `<repo>/runtime/target/debug/oxp-runtime` (dev workflow)
 *   5. `~/.oxp/bin/oxp-runtime` (user install)
 * Errors with a clear message if nothing is found.
 */
async function resolveRuntimeBinary(): Promise<string> {
  const exe = platform() === "win32" ? "oxp-runtime.exe" : "oxp-runtime";

  const fromEnv = process.env.OXP_RUNTIME;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const fromConfig = vscode.workspace
    .getConfiguration("oxp")
    .get<string>("runtimePath");
  if (fromConfig && existsSync(fromConfig)) return fromConfig;

  // Walk up from the workspace folder to find a sibling `runtime/target` —
  // this keeps the dev loop ergonomic (open the OXP repo, F5, it just works).
  const candidates: string[] = [];
  for (const ws of vscode.workspace.workspaceFolders ?? []) {
    const root = ws.uri.fsPath;
    candidates.push(
      join(root, "runtime", "target", "release", exe),
      join(root, "runtime", "target", "debug", exe),
      join(root, "..", "runtime", "target", "release", exe),
      join(root, "..", "runtime", "target", "debug", exe),
    );
  }
  candidates.push(join(homedir(), ".oxp", "bin", exe));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `oxp-runtime not found. Set OXP_RUNTIME, configure 'oxp.runtimePath', ` +
      `or build the runtime: (cd runtime && cargo build --release).`,
  );
}
