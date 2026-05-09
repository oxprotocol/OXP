/**
 * Multi-extension registry / router.
 *
 * `mount()` produces a single `MountedExtension`. PIYE-IDE typically has
 * many active extensions at once (sidebar, panels, status bar, settings).
 * `Registry` is a thin host-side coordinator: track them by id, route
 * events to specific extensions, and broadcast to all.
 *
 * Pure data structure — no DOM, no Worker globals — so unit tests can
 * use a fake `MountedExtension` shim.
 */

import type { MountedExtension } from "./mount.js";

export interface RegistryEntry {
  id: string;
  /** Surface key the extension is mounted on (e.g. "sidebar", "panel-1"). */
  surface: string;
  mounted: MountedExtension;
}

export type RegistryEvent =
  | { kind: "added"; id: string; surface: string }
  | { kind: "removed"; id: string; surface: string };

export type RegistryListener = (e: RegistryEvent) => void;

export class Registry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly listeners = new Set<RegistryListener>();

  /** Number of currently mounted extensions. */
  get size(): number {
    return this.entries.size;
  }

  /** Add a freshly mounted extension. Throws if id is already present. */
  add(entry: RegistryEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`extension already registered: ${entry.id}`);
    }
    this.entries.set(entry.id, entry);
    this.emit({ kind: "added", id: entry.id, surface: entry.surface });
  }

  /**
   * Remove and unmount an extension by id. Returns true if it was present.
   * Safe to call during shutdown — never throws if id is unknown.
   */
  async remove(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    try {
      await entry.mounted.unmount();
    } finally {
      this.emit({ kind: "removed", id, surface: entry.surface });
    }
    return true;
  }

  get(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  list(): RegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Send an event to one specific extension. No-op if id is unknown. */
  send(id: string, topic: string, payload?: unknown): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.mounted.sendEvent(topic, payload);
    return true;
  }

  /** Send an event to every mounted extension. */
  broadcast(topic: string, payload?: unknown): void {
    for (const entry of this.entries.values()) {
      entry.mounted.sendEvent(topic, payload);
    }
  }

  /** Subscribe to add/remove notifications. Returns an unsubscribe fn. */
  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Unmount all extensions, then clear. */
  async shutdown(): Promise<void> {
    const all = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.allSettled(all.map((e) => e.mounted.unmount()));
    for (const e of all) {
      this.emit({ kind: "removed", id: e.id, surface: e.surface });
    }
  }

  private emit(e: RegistryEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* listener errors must never break the registry */
      }
    }
  }
}
