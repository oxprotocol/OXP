/**
 * Cross-host EDH (Extension Development Host) handshake marker.
 *
 * `oxp dev` writes a JSON marker after it has bound a port. The host
 * extension running in the freshly-spawned IDE window reads it on
 * activate, validates folder + freshness, then connects to `wsUrl`
 * directly. The host never spawns its own CLI — there is exactly one
 * `oxp dev` per session, which avoids port collisions on every fork
 * (VS Code, Cursor, Windsurf, Antigravity, VSCodium, …).
 *
 * Schema is versioned so future fields don't silently break old hosts.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const EDH_MARKER_VERSION = 1;

export interface EdhMarker {
  v: number;
  ts: number;
  folderPath: string;
  /** Full WebSocket URL the host should connect to (e.g. ws://127.0.0.1:7373/dev). */
  wsUrl: string;
  /** CLI binary name of the fork that spawned the window (debug/diagnostics). */
  forkBin?: string;
}

export function edhMarkerPath(): string {
  const home =
    process.env.OXP_HOME ??
    join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".oxp");
  return join(home, "edh", "autostart.json");
}

export function writeEdhMarker(marker: Omit<EdhMarker, "v" | "ts">): string {
  const full: EdhMarker = {
    v: EDH_MARKER_VERSION,
    ts: Date.now(),
    ...marker,
  };
  const p = edhMarkerPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(full), "utf8");
  return p;
}

export function deleteEdhMarker(): void {
  const p = edhMarkerPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* noop */
  }
}
