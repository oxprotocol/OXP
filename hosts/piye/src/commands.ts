/**
 * Command palette adapter.
 *
 * Aggregates contributed commands across every extension currently in the
 * `Registry`, exposes a search API for a host palette UI, and dispatches
 * the chosen command back into the owning extension by sending an
 * `oxp:command:<id>` event.
 *
 * Contribution shape (`contributes.commands` JSON file in the bundle):
 *
 *     {
 *       "commands": [
 *         { "id": "hello.greet", "title": "Hello: Greet", "category": "Hello" }
 *       ]
 *     }
 *
 * Hosts load that JSON from the bundle (it is referenced by a path in
 * `manifest.contributes.commands`) and call `palette.register(...)` for
 * each entry. Removing an extension automatically removes its commands.
 */

import type { Registry } from "./registry.js";

export interface CommandContribution {
  /** Stable id, namespaced by convention (`<extension>.<command>`). */
  id: string;
  /** Human-readable label shown in the palette. */
  title: string;
  /** Optional grouping prefix (e.g. "Git", "Files"). */
  category?: string;
  /** Optional keywords to widen fuzzy search. */
  keywords?: readonly string[];
}

export interface CommandsContributionFile {
  commands: readonly CommandContribution[];
}

export interface RegisteredCommand extends CommandContribution {
  /** Extension id that owns this command. */
  extensionId: string;
}

export interface CommandSearchResult extends RegisteredCommand {
  /** Lower is better. 0 means exact prefix on title or id. */
  score: number;
}

/**
 * Parse a `contributes.commands` JSON blob. Throws if the shape is wrong.
 * Hosts call this on the raw file contents from the bundle.
 */
export function parseCommandsContribution(
  raw: string,
): readonly CommandContribution[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `commands contribution: invalid JSON: ${(err as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("commands contribution: expected an object");
  }
  const obj = parsed as { commands?: unknown };
  if (!Array.isArray(obj.commands)) {
    throw new Error("commands contribution: missing `commands` array");
  }
  const out: CommandContribution[] = [];
  for (const entry of obj.commands) {
    if (!entry || typeof entry !== "object") {
      throw new Error("commands contribution: entries must be objects");
    }
    const e = entry as Partial<CommandContribution>;
    if (typeof e.id !== "string" || !/^[a-zA-Z][\w.-]*$/.test(e.id)) {
      throw new Error(`commands contribution: bad id: ${String(e.id)}`);
    }
    if (typeof e.title !== "string" || !e.title.trim()) {
      throw new Error(`commands contribution: missing title for ${e.id}`);
    }
    out.push({
      id: e.id,
      title: e.title,
      category: typeof e.category === "string" ? e.category : undefined,
      keywords: Array.isArray(e.keywords)
        ? (e.keywords.filter((k) => typeof k === "string") as string[])
        : undefined,
    });
  }
  return out;
}

export class CommandPalette {
  private readonly byKey = new Map<string, RegisteredCommand>();
  private readonly unsubscribe: () => void;

  constructor(private readonly registry: Registry) {
    // Auto-clean commands when their owning extension unmounts.
    this.unsubscribe = registry.subscribe((e) => {
      if (e.kind === "removed") this.unregisterAll(e.id);
    });
  }

  /** Stop listening to registry events. Idempotent. */
  dispose(): void {
    this.unsubscribe();
  }

  /**
   * Register all commands contributed by `extensionId`. Replaces any
   * previously registered set for the same extension.
   */
  register(
    extensionId: string,
    commands: readonly CommandContribution[],
  ): void {
    this.unregisterAll(extensionId);
    for (const cmd of commands) {
      const key = `${extensionId}::${cmd.id}`;
      this.byKey.set(key, { ...cmd, extensionId });
    }
  }

  /** Drop every command owned by `extensionId`. */
  unregisterAll(extensionId: string): void {
    const prefix = `${extensionId}::`;
    for (const key of Array.from(this.byKey.keys())) {
      if (key.startsWith(prefix)) this.byKey.delete(key);
    }
  }

  /** All registered commands, in insertion order. */
  list(): readonly RegisteredCommand[] {
    return Array.from(this.byKey.values());
  }

  /**
   * Fuzzy search by title/id/category/keywords. Empty query returns the
   * full list, alphabetised. `limit` defaults to 50.
   */
  search(query: string, limit = 50): readonly CommandSearchResult[] {
    const all = this.list();
    const q = query.trim().toLowerCase();
    if (!q) {
      return all
        .map((c) => ({ ...c, score: 0 }))
        .sort((a, b) => label(a).localeCompare(label(b)))
        .slice(0, limit);
    }
    const scored: CommandSearchResult[] = [];
    for (const cmd of all) {
      const score = scoreCommand(cmd, q);
      if (score < Infinity) scored.push({ ...cmd, score });
    }
    scored.sort(
      (a, b) => a.score - b.score || label(a).localeCompare(label(b)),
    );
    return scored.slice(0, limit);
  }

  /**
   * Dispatch a command. Sends `command:<id>` to the owning extension's
   * Worker; the extension code listens via
   * `addEventListener("oxp:command:<id>", \u2026)`.
   *
   * Returns `false` if the command id is unknown OR the owning extension
   * is no longer mounted.
   */
  execute(extensionId: string, commandId: string, payload?: unknown): boolean {
    const cmd = this.byKey.get(`${extensionId}::${commandId}`);
    if (!cmd) return false;
    return this.registry.send(extensionId, `command:${commandId}`, payload);
  }
}

// ──────────────────────────────────────────────────────────────────────
// scoring
// ──────────────────────────────────────────────────────────────────────

function label(c: RegisteredCommand): string {
  return c.category ? `${c.category}: ${c.title}` : c.title;
}

function scoreCommand(cmd: RegisteredCommand, q: string): number {
  const candidates = [
    cmd.title.toLowerCase(),
    cmd.id.toLowerCase(),
    cmd.category?.toLowerCase() ?? "",
    ...(cmd.keywords?.map((k) => k.toLowerCase()) ?? []),
  ];
  let best = Infinity;
  for (const c of candidates) {
    if (!c) continue;
    if (c === q) return 0;
    if (c.startsWith(q)) best = Math.min(best, 1);
    else if (c.includes(q)) best = Math.min(best, 5);
    else {
      const sub = subsequenceScore(c, q);
      if (sub !== Infinity) best = Math.min(best, 10 + sub);
    }
  }
  return best;
}

function subsequenceScore(text: string, query: string): number {
  let i = 0;
  let gaps = 0;
  let lastIdx = -1;
  for (let j = 0; j < text.length && i < query.length; j++) {
    if (text[j] === query[i]) {
      if (lastIdx >= 0) gaps += j - lastIdx - 1;
      lastIdx = j;
      i++;
    }
  }
  if (i < query.length) return Infinity;
  return gaps;
}
