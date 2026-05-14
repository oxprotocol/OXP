/**
 * Append-only MCP operation log at ~/.oxp/logs/mcp-install.jsonl
 *
 * Every install, rollback, and reachability probe appends one JSON line.
 * Failures here are silently swallowed — logging must never break the main
 * flow.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { oxpHome } from "../util.js";

export type McpLogKind = "install" | "rollback" | "probe";

export interface McpLogEntry {
  ts: string;
  kind: McpLogKind;
  id: string;
  client?: string;
  status: "ok" | "skipped" | "failed" | "reachable" | "unreachable";
  reason?: string;
}

export async function appendMcpLog(
  entry: Omit<McpLogEntry, "ts">,
): Promise<void> {
  try {
    const dir = join(oxpHome(), "logs");
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const p = join(dir, "mcp-install.jsonl");
    const line: McpLogEntry = { ts: new Date().toISOString(), ...entry };
    await fs.appendFile(p, JSON.stringify(line) + "\n", {
      mode: 0o600,
    });
  } catch {
    // Non-fatal — logging must never abort an install or rollback.
  }
}
