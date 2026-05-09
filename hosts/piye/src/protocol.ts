/**
 * The Piye ↔ extension Worker wire protocol.
 *
 * Every message is a discriminated union. Both directions use the same shape
 * so a host-driven capability call and an extension-driven event share the
 * same envelope.
 *
 * V1 capabilities (locked):
 *   read-clipboard, write-clipboard, network:<domain>, storage:local
 *
 * Permissions are checked on the HOST side before any capability is invoked.
 * The Worker may request anything; the host enforces oxp.json.permissions.
 */

import type { ManifestCommon } from "@oxprotocol/host-core";

export type CapabilityName =
  | "read-clipboard"
  | "write-clipboard"
  | "storage:local"
  | `network:${string}`;

/** Sent from host → worker once at startup. */
export interface BootMessage {
  kind: "boot";
  manifest: ManifestCommon & Record<string, unknown>;
  /** Verified bundle files keyed by POSIX path. Worker sees a snapshot. */
  files: Record<string, Uint8Array>;
  /** The host's chosen entry path (manifest.main.entry or default). */
  entry: string;
}

/** Worker → host: invoke a capability. Host responds with `result`. */
export interface CapabilityRequest {
  kind: "capability";
  id: string;
  capability: CapabilityName;
  args: unknown;
}

/** Host → worker: response to a CapabilityRequest. */
export interface CapabilityResponse {
  kind: "capability:result";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Worker → host: request a UI tree update for the mounted Shadow DOM. */
export interface RenderMessage {
  kind: "render";
  /** Either raw HTML (Pillar 1) or an @oxprotocol/ui component tree (Pillar 4). */
  payload: { type: "html"; html: string } | { type: "ui-tree"; tree: unknown };
}

/** Worker → host: log line for the host's debug pane. */
export interface LogMessage {
  kind: "log";
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

/** Host → worker: shutdown signal before terminate(). */
export interface ShutdownMessage {
  kind: "shutdown";
}

/** Host → worker: a host-emitted event (e.g. user interaction, clipboard). */
export interface EventMessage {
  kind: "event";
  topic: string;
  payload: unknown;
}

export type HostToWorker =
  | BootMessage
  | CapabilityResponse
  | EventMessage
  | ShutdownMessage;

export type WorkerToHost = CapabilityRequest | RenderMessage | LogMessage;
