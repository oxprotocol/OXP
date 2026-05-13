/**
 * Explorer slot manager.
 *
 * The host extension declares 8 static Explorer view slots in its
 * package.json (`oxp.explorer.slot.0` … `oxp.explorer.slot.7`), each
 * gated by a matching context key. This manager:
 *
 *   - Persists which OXP extension is assigned to each slot
 *   - Registers a `WrapperWebviewProvider` for every occupied slot so
 *     the slot renders the correct extension UI
 *   - Sets / clears the context keys so VS Code shows or hides the view
 *
 * Callers (Switchboard, extension.ts) only need `setVisible()` and
 * `restoreAll()`. The slot details are internal.
 */

import * as vscode from "vscode";
import type { Store } from "@oxprotocol/host-core";
import { WrapperWebviewProvider } from "./wrapper-provider";

const ALLOC_KEY = "oxp.explorerSlots.allocation";
const VIS_KEY = "oxp.explorerSlots.visibility";
const SLOT_COUNT = 8;
export const SLOT_PREFIX = "oxp.explorer.slot.";

export class ExplorerSlotManager {
  /** slotIndex → extensionId */
  private allocation = new Map<number, string>();
  /** extensionId → slotIndex */
  private reverseAlloc = new Map<string, number>();
  /** extensionId → visible */
  private visibility = new Map<string, boolean>();
  /** slotIndex → vscode.Disposable (WebviewViewProvider registration) */
  private registrations = new Map<number, vscode.Disposable>();

  constructor(
    private readonly store: Store,
    private readonly context: vscode.ExtensionContext,
  ) {
    const alloc = context.globalState.get<Record<string, string>>(ALLOC_KEY, {});
    for (const [k, v] of Object.entries(alloc)) {
      const i = Number(k);
      this.allocation.set(i, v);
      this.reverseAlloc.set(v, i);
    }
    const vis = context.globalState.get<Record<string, boolean>>(VIS_KEY, {});
    this.visibility = new Map(Object.entries(vis));
  }

  /**
   * Restore slots and context keys from persisted state. Call once at
   * extension activate, after the store is ready.
   */
  async restoreAll(): Promise<void> {
    // Ensure all known extensions default to visible
    let dirty = false;
    for (const [, extId] of this.allocation.entries()) {
      if (!this.visibility.has(extId)) {
        this.visibility.set(extId, true);
        dirty = true;
      }
    }
    if (dirty) await this.persistVisibility();

    for (const [slotIdx, extId] of this.allocation.entries()) {
      this.registerSlotProvider(slotIdx, extId);
      const visible = this.visibility.get(extId) ?? true;
      await this.setSlotContext(slotIdx, visible);
    }
  }

  /**
   * Show or hide an extension's Explorer panel.
   *
   * If the extension doesn't yet have a slot allocated and `visible` is
   * `true`, a new slot is allocated (up to SLOT_COUNT). Calling with
   * `visible = false` for an extension that has no slot is a no-op.
   */
  async setVisible(extId: string, visible: boolean): Promise<void> {
    this.visibility.set(extId, visible);
    await this.persistVisibility();

    let slot = this.reverseAlloc.get(extId);

    if (slot === undefined) {
      if (!visible) return; // nothing to do
      slot = this.allocateSlot(extId);
      if (slot === null) {
        void vscode.window.showWarningMessage(
          `OXP: All ${SLOT_COUNT} Explorer slots are in use. Toggle off another extension first.`,
        );
        return;
      }
      await this.persistAllocation();
      this.registerSlotProvider(slot, extId);
    }

    await this.setSlotContext(slot, visible);
  }

  /** Returns true if the extension is currently visible. */
  isVisible(extId: string): boolean {
    return this.visibility.get(extId) ?? false;
  }

  /**
   * Called when a new extension is installed. Defaults it to visible
   * and allocates a slot if possible.
   */
  async onExtensionInstalled(extId: string): Promise<void> {
    await this.setVisible(extId, true);
  }

  /** Returns the OXP extension ID currently occupying `slotId`. */
  getExtensionForSlot(slotId: string): string | undefined {
    const idx = slotIndex(slotId);
    if (idx === undefined) return undefined;
    return this.allocation.get(idx);
  }

  private allocateSlot(extId: string): number | null {
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!this.allocation.has(i)) {
        this.allocation.set(i, extId);
        this.reverseAlloc.set(extId, i);
        return i;
      }
    }
    return null;
  }

  private registerSlotProvider(slotIdx: number, extId: string): void {
    this.registrations.get(slotIdx)?.dispose();
    const provider = new WrapperWebviewProvider(extId, this.store, this.context);
    const viewId = SLOT_PREFIX + slotIdx;
    const disposable = vscode.window.registerWebviewViewProvider(viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
    this.registrations.set(slotIdx, disposable);
    this.context.subscriptions.push(disposable);
  }

  private async setSlotContext(slotIdx: number, visible: boolean): Promise<void> {
    await vscode.commands.executeCommand(
      "setContext",
      SLOT_PREFIX + slotIdx,
      visible,
    );
  }

  private async persistAllocation(): Promise<void> {
    const obj: Record<string, string> = {};
    for (const [i, id] of this.allocation.entries()) obj[String(i)] = id;
    await this.context.globalState.update(ALLOC_KEY, obj);
  }

  private async persistVisibility(): Promise<void> {
    await this.context.globalState.update(
      VIS_KEY,
      Object.fromEntries(this.visibility.entries()),
    );
  }
}

export function slotIndex(slotId: string): number | undefined {
  if (!slotId.startsWith(SLOT_PREFIX)) return undefined;
  const n = parseInt(slotId.slice(SLOT_PREFIX.length), 10);
  return isNaN(n) ? undefined : n;
}
