/**
 * MCP-aware client detection + config merging.
 *
 * Each MCP-aware client stores its server list in a JSON file at a
 * platform-specific path. `oxp install @scope/slug` (when the id resolves
 * to an MCP entry on the registry) merges the server's launcher spec into
 * every detected client's file, idempotently.
 *
 * We never delete or overwrite unrelated keys — the merge only touches
 * `mcpServers[<slug>]` (or the equivalent path for that client).
 *
 * No client config is created from scratch unless the parent directory
 * already exists, so we don't accidentally "install" a client the user
 * doesn't actually have.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type ClientId =
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "vscode-insiders"
  | "windsurf";

export interface ClientTarget {
  id: ClientId;
  displayName: string;
  /** Absolute path to the JSON config file. */
  configPath: string;
  /**
   * Dotted path inside the JSON where servers are listed.
   * "mcpServers" for Claude/Cursor/Windsurf, "mcp.servers" for VS Code.
   */
  serversKey: string;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type InstallStatus = "installed" | "updated" | "skipped" | "failed";

export interface InstallReport {
  client: ClientTarget;
  status: InstallStatus;
  /** Reason for skipped/failed; undefined on success. */
  reason?: string;
}

const HOME = os.homedir();

/* -------------------------------------------------------------------------- */
/* Config-path resolution per platform                                        */
/* -------------------------------------------------------------------------- */

function appSupport(...rest: string[]): string {
  switch (process.platform) {
    case "darwin":
      return path.join(HOME, "Library", "Application Support", ...rest);
    case "win32": {
      const appdata =
        process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming");
      return path.join(appdata, ...rest);
    }
    default:
      // Linux/BSD — XDG_CONFIG_HOME or ~/.config
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(HOME, ".config"),
        ...rest,
      );
  }
}

/**
 * Build the candidate target list. We always return all known clients —
 * the install pass filters out the ones whose parent directory is missing.
 */
export function knownClients(): ClientTarget[] {
  return [
    {
      id: "claude-desktop",
      displayName: "Claude Desktop",
      configPath: appSupport("Claude", "claude_desktop_config.json"),
      serversKey: "mcpServers",
    },
    {
      id: "cursor",
      displayName: "Cursor",
      // Cursor 0.42+ reads ~/.cursor/mcp.json (cross-platform, not under appSupport)
      configPath: path.join(HOME, ".cursor", "mcp.json"),
      serversKey: "mcpServers",
    },
    {
      id: "vscode",
      displayName: "VS Code (Copilot)",
      // VS Code's Copilot MCP is in user settings.json under "mcp.servers".
      // We use the dedicated mcp.json file (VS Code 1.97+) which it also reads.
      configPath: appSupport("Code", "User", "mcp.json"),
      serversKey: "servers",
    },
    {
      id: "vscode-insiders",
      displayName: "VS Code Insiders",
      configPath: appSupport("Code - Insiders", "User", "mcp.json"),
      serversKey: "servers",
    },
    {
      id: "windsurf",
      displayName: "Windsurf",
      configPath: path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
      serversKey: "mcpServers",
    },
  ];
}

/**
 * Detect which clients look installed: parent directory of the config path
 * exists. Cheap and reliable — we never need the binary itself, just a
 * place to write the config.
 */
export async function detectClients(): Promise<ClientTarget[]> {
  const candidates = knownClients();
  const present: ClientTarget[] = [];
  for (const c of candidates) {
    try {
      const dir = path.dirname(c.configPath);
      const stat = await fs.stat(dir);
      if (stat.isDirectory()) present.push(c);
    } catch {
      /* missing dir — client not installed */
    }
  }
  return present;
}

/* -------------------------------------------------------------------------- */
/* Merge logic                                                                */
/* -------------------------------------------------------------------------- */

async function readJsonSafe(
  p: string,
): Promise<{ data: Record<string, unknown>; existed: boolean }> {
  try {
    const buf = await fs.readFile(p, "utf8");
    const trimmed = buf.trim();
    if (!trimmed) return { data: {}, existed: true };
    return {
      data: JSON.parse(trimmed) as Record<string, unknown>,
      existed: true,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { data: {}, existed: false };
    }
    throw err;
  }
}

/**
 * Walk a dotted key path and ensure every intermediate level is an object.
 * Returns the leaf object that holds the per-server entries.
 */
function ensurePath(
  root: Record<string, unknown>,
  dotted: string,
): Record<string, unknown> {
  const parts = dotted.split(".");
  let cur: Record<string, unknown> = root;
  for (const part of parts) {
    const next = cur[part];
    if (next && typeof next === "object" && !Array.isArray(next)) {
      cur = next as Record<string, unknown>;
    } else {
      const fresh: Record<string, unknown> = {};
      cur[part] = fresh;
      cur = fresh;
    }
  }
  return cur;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge a single MCP server entry into a single client config file.
 * Atomic-ish: write to a sibling temp file then rename.
 */
export async function mergeServerInto(
  client: ClientTarget,
  serverSlug: string,
  entry: McpServerEntry,
): Promise<InstallReport> {
  try {
    const { data } = await readJsonSafe(client.configPath);
    const bucket = ensurePath(data, client.serversKey);
    const existing = bucket[serverSlug];
    if (existing && shallowEqual(existing, entry)) {
      return { client, status: "skipped", reason: "already configured" };
    }
    const updated = Boolean(existing);
    bucket[serverSlug] = entry;
    await fs.mkdir(path.dirname(client.configPath), { recursive: true });
    const tmp = `${client.configPath}.oxp-tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await fs.rename(tmp, client.configPath);
    return { client, status: updated ? "updated" : "installed" };
  } catch (err) {
    return {
      client,
      status: "failed",
      reason: (err as Error).message,
    };
  }
}

/**
 * Remove a server entry from every detected client's config. Used by
 * `oxp uninstall` — silently skips clients that don't have the entry.
 */
export async function removeServerFrom(
  client: ClientTarget,
  serverSlug: string,
): Promise<InstallReport> {
  try {
    const { data, existed } = await readJsonSafe(client.configPath);
    if (!existed)
      return { client, status: "skipped", reason: "no config file" };
    const bucket = ensurePath(data, client.serversKey);
    if (!(serverSlug in bucket)) {
      return { client, status: "skipped", reason: "not configured" };
    }
    delete bucket[serverSlug];
    const tmp = `${client.configPath}.oxp-tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await fs.rename(tmp, client.configPath);
    return { client, status: "updated" };
  } catch (err) {
    return {
      client,
      status: "failed",
      reason: (err as Error).message,
    };
  }
}
