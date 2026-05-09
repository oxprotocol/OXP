/**
 * Cross-process broadcast — tell every running OXP host that the
 * shared store has changed so they can hot-reload without a restart.
 *
 * Mechanism (intentionally minimal, no daemon):
 *
 *   1. CLI writes a one-line JSON event to `~/.oxp/notify/inbox.jsonl`
 *      (append-only). Each line carries `{ts, kind, id, version}`.
 *   2. Hosts watch that file with `fs.watch` and replay events newer
 *      than the last position they recorded in their globalState.
 *
 * This avoids the complexity of a real socket server while still giving
 * the "magical" UX where the extension appears in a running VS Code the
 * moment `oxp install` finishes. When we ship `oxpd` the same file
 * becomes a write-through audit log behind the daemon.
 *
 * The notify file is a best-effort signal: if it can't be written we
 * silently skip — the host will still pick up the install on next
 * launch by reading `installed.json`.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import { oxpHome } from "../util.js";

export interface NotifyEvent {
  /** ISO timestamp the event was recorded. */
  ts: string;
  /** What changed. `installed` is emitted by `oxp install`. */
  kind: "installed" | "uninstalled" | "updated";
  /** Extension id that changed (`@publisher/slug`). */
  id: string;
  /** Version that is now active in the shared store. */
  version: string;
  /** Optional human note for debugging. */
  note?: string;
}

/**
 * Append a notify event to the shared inbox. Never throws — the worst
 * case is a missed in-process refresh, which the host recovers from on
 * its next manual reload.
 */
export async function broadcast(event: Omit<NotifyEvent, "ts">): Promise<void> {
  const dir = join(oxpHome(), "notify");
  const file = join(dir, "inbox.jsonl");
  const line =
    JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.appendFile(file, line, { mode: 0o600 });
  } catch {
    // best-effort
  }
}

/** Path of the shared inbox — exported so hosts can `fs.watch` it. */
export function notifyInboxPath(): string {
  return join(oxpHome(), "notify", "inbox.jsonl");
}
