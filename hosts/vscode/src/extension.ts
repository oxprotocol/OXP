import * as vscode from "vscode";
import * as fsSync from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  resolveAndVerify,
  Store,
  Grants,
  RuntimeManager,
  VerifyError,
  kindOf,
  finishInstallWithConsent,
  type InstalledRecord,
  type PermissionPromptFn,
  type PermissionPromptItem,
} from "@oxprotocol/host-core";
import { jcoBackend } from "@oxprotocol/host-runtime";
import { vscodeHostFs } from "./fs-adapter";
import { devCommand } from "./dev";
import { renderMainUi } from "./render";
import { vscodeProviderFactory } from "./runtime-provider";
import { RuntimeRpcService } from "./runtime-rpc-service";
import { ExtensionUiPanel } from "./extension-ui-panel";
import { RuntimePanel } from "./runtime-panel";

let store: Store;
let grants: Grants;
let runtimeManager: RuntimeManager;
let logChannel: vscode.OutputChannel;
let runtimeRpc: RuntimeRpcService;
let notifyWatcher: fsSync.FSWatcher | undefined;

function registry(): string {
  return (
    vscode.workspace.getConfiguration("oxp").get<string>("registry") ??
    "https://oxp.sh"
  );
}

/**
 * Resolve the store root that this VS Code instance reads from.
 *
 * When `oxp.useSharedStore` is true (default) the host points at
 * `$OXP_HOME/host-store` (~/.oxp/host-store) so a single `oxp install`
 * on the command line is reflected in every running IDE. When false
 * we fall back to per-extension globalStorage — useful for isolated
 * test profiles or CI.
 */
function resolveStoreRoot(context: vscode.ExtensionContext): string {
  const cfg = vscode.workspace.getConfiguration("oxp");
  const useShared = cfg.get<boolean>("useSharedStore", true);
  if (!useShared) return context.globalStorageUri.toString();
  const home = process.env.OXP_HOME ?? join(homedir(), ".oxp");
  return vscode.Uri.file(join(home, "host-store")).toString();
}

export function activate(context: vscode.ExtensionContext): void {
  const fs = vscodeHostFs();
  const root = resolveStoreRoot(context);
  store = new Store(fs, root);
  grants = new Grants(fs, root);

  logChannel = vscode.window.createOutputChannel("OXP Extensions");
  context.subscriptions.push(logChannel);

  runtimeManager = new RuntimeManager({
    runtime: () => jcoBackend(),
    fs,
    store,
    providerFactory: vscodeProviderFactory(context, logChannel),
    hostName: "vscode",
    hostVersion: vscode.version,
  });

  runtimeRpc = new RuntimeRpcService(logChannel);
  context.subscriptions.push({
    dispose: () => {
      void runtimeRpc.dispose();
    },
  });

  // Render extension-driven UI trees and surface status/notify events.
  context.subscriptions.push(
    runtimeRpc.onUiRender((ev) =>
      ExtensionUiPanel.showOrUpdate(runtimeRpc, ev),
    ),
    runtimeRpc.onUiStatus((ev) => {
      logChannel.appendLine(`[ui.status ${ev.extensionId}] ${ev.text}`);
    }),
    runtimeRpc.onUiNotify((ev) => {
      const buttons = ev.buttons.length ? ev.buttons : [];
      void vscode.window.showInformationMessage(
        `[${ev.extensionId}] ${ev.message}`,
        ...buttons,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("oxp.install", () => installCommand()),
    vscode.commands.registerCommand("oxp.list", () => listCommand()),
    vscode.commands.registerCommand("oxp.open", (id?: string) =>
      openCommand(id),
    ),
    vscode.commands.registerCommand("oxp.uninstall", (id?: string) =>
      uninstallCommand(id),
    ),
    vscode.commands.registerCommand("oxp.dev", () => devCommand(context)),
    vscode.commands.registerCommand("oxp.reload", () => reloadCommand()),
    vscode.commands.registerCommand("oxp.activate", (id?: string) =>
      activateCommand(id),
    ),
    vscode.commands.registerCommand("oxp.deactivate", (id?: string) =>
      deactivateCommand(id),
    ),
    vscode.commands.registerCommand("oxp.showLogs", () => logChannel.show()),
    // Rust-runtime path — spawns the oxp-runtime binary and surfaces a
    // webview that loads/activates a wasm component end to end.
    vscode.commands.registerCommand("oxp.runtime.show", () => {
      RuntimePanel.show(runtimeRpc, context);
    }),
    vscode.commands.registerCommand("oxp.runtime.stop", async () => {
      await runtimeRpc.dispose();
      vscode.window.showInformationMessage("OXP runtime stopped.");
    }),
    vscode.commands.registerCommand(
      "oxp.runtime.installFromUrl",
      async (url?: string) => {
        const panel = RuntimePanel.show(runtimeRpc, context);
        if (typeof url === "string" && url.length > 0) {
          await panel.installFromUrl(url);
        } else {
          await panel.installFromUrlInteractive();
        }
      },
    ),
    vscode.commands.registerCommand("oxp.runtime.pickUrlInstall", async () => {
      const panel = RuntimePanel.show(runtimeRpc, context);
      await panel.pickAndActivateUrlInstall();
    }),
  );

  // Watch the shared notify inbox so CLI installs surface immediately
  // in this running VS Code window.
  startNotifyWatcher(context);
}

export async function deactivate(): Promise<void> {
  // Dispose every running component before VS Code tears down the
  // extension host. Without this the wasm stores leak across reloads.
  notifyWatcher?.close();
  if (runtimeManager) {
    await runtimeManager.disposeAll();
  }
}

/* -------------------------------------------------------------------------- */
/* Cross-process broadcast watcher                                            */
/* -------------------------------------------------------------------------- */

function notifyInboxPath(): string {
  const home = process.env.OXP_HOME ?? join(homedir(), ".oxp");
  return join(home, "notify", "inbox.jsonl");
}

function startNotifyWatcher(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration("oxp");
  if (!cfg.get<boolean>("useSharedStore", true)) return;

  const file = notifyInboxPath();
  // Tail the file from end so we only see *new* events, not the backlog.
  let lastSize = 0;
  try {
    lastSize = fsSync.statSync(file).size;
  } catch {
    // file doesn't exist yet — watch the parent dir until it appears.
  }

  const dir = join(file, "..");
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }

  let pending = false;
  const onChange = (): void => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      try {
        const stat = fsSync.statSync(file);
        if (stat.size <= lastSize) {
          lastSize = stat.size;
          return;
        }
        const fd = fsSync.openSync(file, "r");
        try {
          const buf = Buffer.alloc(stat.size - lastSize);
          fsSync.readSync(fd, buf, 0, buf.length, lastSize);
          lastSize = stat.size;
          for (const line of buf.toString("utf8").split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const ev = JSON.parse(line) as {
                kind: string;
                id: string;
                version: string;
              };
              handleNotifyEvent(ev);
            } catch {
              /* malformed line — skip */
            }
          }
        } finally {
          fsSync.closeSync(fd);
        }
      } catch {
        // file vanished or unreadable — try again on next event
      }
    }, 100);
  };

  try {
    notifyWatcher = fsSync.watch(dir, (_event, filename) => {
      if (filename === "inbox.jsonl") onChange();
    });
    context.subscriptions.push({ dispose: () => notifyWatcher?.close() });
  } catch {
    // watch unsupported on this fs (e.g. some network mounts) — fall
    // back to polling so the feature degrades gracefully.
    const interval = setInterval(onChange, 2000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
  }
}

function handleNotifyEvent(ev: {
  kind: string;
  id: string;
  version: string;
}): void {
  if (ev.kind !== "installed" && ev.kind !== "updated") return;
  logChannel.appendLine(
    `[notify] ${ev.kind} ${ev.id}@${ev.version} — reloading store`,
  );
  // The store reads installed.json on demand, so a notification only
  // needs to surface a quiet status message; existing list/open
  // commands will pick up the new entry on next invocation.
  vscode.window.setStatusBarMessage(
    `OXP: ${ev.id}@${ev.version} installed`,
    5000,
  );
}

async function reloadCommand(): Promise<void> {
  vscode.window.setStatusBarMessage("OXP: store reloaded", 2000);
}

async function installCommand(): Promise<void> {
  const id = await vscode.window.showInputBox({
    title: "OXP: Install Extension",
    prompt: "Enter extension id",
    placeHolder: "@publisher/slug",
    validateInput: (v) =>
      /^@[^/]+\/[^/]+$/.test(v) ? null : "Format: @publisher/slug",
  });
  if (!id) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing ${id}`,
    },
    async (progress) => {
      try {
        progress.report({ message: "resolving + verifying…" });
        const verified = await resolveAndVerify(registry(), id);

        progress.report({ message: "checking permissions…" });
        const { record, prompted } = await finishInstallWithConsent(
          verified,
          store,
          grants,
          vscodePermissionPrompt,
        );
        if (prompted) {
          progress.report({ message: "writing files…" });
        } else {
          progress.report({ message: "writing files…" });
        }

        // Component-v1 / hybrid-v1 → activate immediately.
        if (kindOf(record.manifest) !== "ui-v1") {
          progress.report({ message: "activating component…" });
          try {
            await runtimeManager.activate(record);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Installed ${record.id} but activation failed: ${(err as Error).message}`,
            );
            logChannel.show(true);
            return;
          }
        }

        const buttons: string[] = [];
        if (record.manifest.main?.ui) buttons.push("Open");
        if (kindOf(record.manifest) !== "ui-v1") buttons.push("Show Logs");

        const choice = await vscode.window.showInformationMessage(
          `Installed ${record.id}@${record.version}`,
          ...buttons,
        );
        if (choice === "Open") await openInstalled(record);
        else if (choice === "Show Logs") logChannel.show();
      } catch (err) {
        const msg =
          err instanceof VerifyError
            ? `${err.code}: ${err.message}`
            : (err as Error).message;
        vscode.window.showErrorMessage(`Install failed: ${msg}`);
      }
    },
  );
}

/**
 * Phase A.4 — install-time permission prompt for VS Code.
 *
 * UX flow:
 *   1. Modal warning lists every requested permission. User picks
 *      Allow All / Customize / Deny.
 *   2. "Allow All" grants the full requested set.
 *   3. "Customize" opens a multi-select QuickPick pre-checking the
 *      previously-granted items (or all-checked on a fresh install).
 *   4. "Deny" / dismiss aborts the install with PERMISSION_DENIED_BY_USER.
 *
 * The prompt deliberately does NOT show ambient capabilities
 * (notifications, log, storage) — `buildPromptItems` filters them
 * upstream so the user only sees the things that actually matter.
 */
const vscodePermissionPrompt: PermissionPromptFn = async (req) => {
  const lines = req.items
    .map((it) => {
      const badge =
        it.sensitivity === "sensitive"
          ? " ⚠"
          : it.sensitivity === "install-time"
            ? ""
            : "";
      const scope = it.scope ? ` (${it.scope})` : "";
      const seen = it.previouslyGranted ? " ✓" : "";
      return `  • ${it.description}${scope}${badge}${seen}`;
    })
    .join("\n");
  const heading = req.isUpgrade
    ? `${req.displayName} v${req.version} requests new permissions:`
    : `${req.displayName} v${req.version} requests these permissions:`;
  const choice = await vscode.window.showWarningMessage(
    `${heading}\n\n${lines}\n\nGrant access?`,
    { modal: true },
    "Allow All",
    "Customize",
  );
  if (!choice) return { kind: "deny", reason: "user dismissed prompt" };
  if (choice === "Allow All") {
    return { kind: "grant", grantedRaw: req.items.map((i) => i.raw) };
  }
  // Customize → multi-select QuickPick.
  const picks = await vscode.window.showQuickPick(
    req.items.map((it: PermissionPromptItem) => ({
      label: it.description + (it.scope ? ` (${it.scope})` : ""),
      description: it.capability,
      detail:
        it.sensitivity === "sensitive"
          ? "Sensitive — re-checked on each use"
          : it.sensitivity === "install-time"
            ? "Install-time"
            : "",
      picked: it.previouslyGranted || !req.isUpgrade,
      raw: it.raw,
    })),
    {
      title: `Customize permissions for ${req.displayName}`,
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );
  if (!picks) return { kind: "deny", reason: "user dismissed customize" };
  return { kind: "grant", grantedRaw: picks.map((p) => p.raw) };
};

async function pickInstalled(
  title: string,
): Promise<InstalledRecord | undefined> {
  const records = await store.list();
  if (records.length === 0) {
    vscode.window.showInformationMessage("No OXP extensions installed.");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    records.map((r) => ({
      label: r.id,
      description: r.version,
      detail: `keyId ${r.keyId.slice(0, 24)}…  tar ${r.tarSha256.slice(0, 12)}…  ${
        runtimeManager.isActive(r.id) ? "● running" : "○ stopped"
      }`,
      record: r,
    })),
    { title, matchOnDescription: true, matchOnDetail: true },
  );
  return pick?.record;
}

async function listCommand(): Promise<void> {
  const pick = await pickInstalled("Installed OXP Extensions");
  if (pick) await openInstalled(pick);
}

async function openCommand(id?: string): Promise<void> {
  const record = id
    ? await store.get(id)
    : await pickInstalled("Open OXP Extension");
  if (!record) return;
  await openInstalled(record);
}

async function uninstallCommand(id?: string): Promise<void> {
  const record = id
    ? await store.get(id)
    : await pickInstalled("Uninstall OXP Extension");
  if (!record) return;
  const ok = await vscode.window.showWarningMessage(
    `Uninstall ${record.id}@${record.version}?`,
    { modal: true },
    "Uninstall",
  );
  if (ok !== "Uninstall") return;
  // Deactivate the live component (if any) before deleting files so the
  // wasm store releases its handles to the install dir.
  await runtimeManager.deactivate(record.id);
  await store.uninstall(record.id);
  vscode.window.showInformationMessage(`Uninstalled ${record.id}`);
}

async function activateCommand(id?: string): Promise<void> {
  const record = id
    ? await store.get(id)
    : await pickInstalled("Activate OXP Extension");
  if (!record) return;
  if (kindOf(record.manifest) === "ui-v1") {
    vscode.window.showWarningMessage(
      `${record.id} is a ui-v1 bundle and has no component to activate.`,
    );
    return;
  }
  try {
    await runtimeManager.activate(record);
    vscode.window.showInformationMessage(
      `Activated ${record.id}@${record.version}`,
    );
    logChannel.show(true);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Activation failed: ${(err as Error).message}`,
    );
  }
}

async function deactivateCommand(id?: string): Promise<void> {
  const record = id
    ? await store.get(id)
    : await pickInstalled("Deactivate OXP Extension");
  if (!record) return;
  const ran = await runtimeManager.deactivate(record.id);
  vscode.window.showInformationMessage(
    ran ? `Deactivated ${record.id}` : `${record.id} was not active`,
  );
}

async function openInstalled(record: InstalledRecord): Promise<void> {
  const uiRel = record.manifest.main?.ui;
  if (!uiRel) {
    // Component-only extension — there's no webview to render. Show the
    // log channel instead so the user can see lifecycle output.
    if (kindOf(record.manifest) !== "ui-v1") {
      logChannel.show(true);
      return;
    }
    vscode.window.showWarningMessage(
      `${record.id} has no main.ui — nothing to render`,
    );
    return;
  }

  const surface =
    record.manifest.ui?.preferredSurface === "sidebar"
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.Active;

  const resourceRoot = vscode.Uri.parse(store.resourcePath(record));

  const panel = vscode.window.createWebviewPanel(
    "oxp.extension",
    `${record.manifest.displayName ?? record.id}`,
    surface,
    {
      enableScripts: true,
      localResourceRoots: [resourceRoot],
      retainContextWhenHidden: true,
    },
  );

  const outcome = await renderMainUi({
    manifest: record.manifest,
    resourceRoot,
    webview: panel.webview,
    read: async (rel) =>
      vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(resourceRoot, ...rel.split("/")),
      ),
  });

  if (outcome.kind === "empty") {
    vscode.window.showErrorMessage(`${record.id}: ${outcome.reason}`);
    panel.dispose();
    return;
  }

  panel.webview.html = outcome.html;
}
