/**
 * VS Code-flavoured `HostCapabilityProvider` for the OXP runtime.
 *
 * - `log`     → an "OXP Extensions" `OutputChannel`. Each line is prefixed
 *               with the extension id so multiple components share the
 *               channel without ambiguity.
 * - `storage` → `context.globalState`, namespaced per-extension so two
 *               extensions can use the same key safely.
 * - `ui`      → `notify` shows a toast (with optional buttons → `showInformationMessage`),
 *               `setStatus` updates the status bar for ~5s,
 *               `render` is a no-op stub (component-v1 doesn't ship a UI tree
 *               format yet — when it does this will deserialize & forward to
 *               the same WebView pipeline used for ui-v1 bundles).
 *
 * Gated capabilities (fs / net / secrets / commands) are intentionally not
 * provided yet — the broker enforces PERMISSION_DENIED for any extension
 * whose manifest declares them. That's tracked under Phase A.4 / A.6.
 */

import * as vscode from "vscode";
import {
  RuntimeError,
  type HostCapabilityProvider,
  type LogLevel,
} from "@oxprotocol/host-runtime";
import type { InstalledRecord } from "@oxprotocol/host-core";

/** Build the per-extension provider. Reuses one shared OutputChannel. */
export function vscodeProviderFactory(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
) {
  return (record: InstalledRecord): HostCapabilityProvider => {
    const tag = `[${record.id}@${record.version}]`;
    const storagePrefix = `oxp:storage:${record.id}:`;

    return {
      log: {
        log(level: LogLevel, message: string) {
          channel.appendLine(
            `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${tag} ${message}`,
          );
        },
      },
      storage: {
        async get(key: string): Promise<Uint8Array | undefined> {
          const v = context.globalState.get<string>(storagePrefix + key);
          return v ? Buffer.from(v, "base64") : undefined;
        },
        async set(key: string, value: Uint8Array): Promise<void> {
          await context.globalState.update(
            storagePrefix + key,
            Buffer.from(value).toString("base64"),
          );
        },
        async delete(key: string): Promise<void> {
          await context.globalState.update(storagePrefix + key, undefined);
        },
        async keys(): Promise<string[]> {
          return context.globalState
            .keys()
            .filter((k) => k.startsWith(storagePrefix))
            .map((k) => k.slice(storagePrefix.length));
        },
      },
      ui: {
        async render(_tree: Uint8Array): Promise<void> {
          // Surfacing component-driven UI from a wasm tree is part of the
          // ui-bridge work tracked under Phase A.6. Until then, fail loud
          // rather than silently swallow the call — extensions that ship a
          // UI tree need to know the host can't display it yet.
          channel.appendLine(
            `${tag} ui.render(${_tree.byteLength}b) — rejected (CAPABILITY_NOT_READY)`,
          );
          throw new RuntimeError(
            "host has not implemented ui.render for component bundles yet",
            "CAPABILITY_NOT_READY",
            { extensionId: record.id, capability: "ui.render" },
          );
        },
        async setStatus(text: string, tooltip?: string): Promise<void> {
          vscode.window.setStatusBarMessage(
            `$(extensions) ${tag} ${text}${tooltip ? ` — ${tooltip}` : ""}`,
            5000,
          );
        },
        async notify(
          message: string,
          buttons?: readonly string[],
        ): Promise<string | undefined> {
          const items = (buttons ?? []) as string[];
          return vscode.window.showInformationMessage(
            `${tag} ${message}`,
            ...items,
          );
        },
      },
    };
  };
}
