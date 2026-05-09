/**
 * MCP server registry — read-only data access for the curated mirror of the
 * public Model Context Protocol registry.
 *
 * Source of truth lives at `lib/mcp-servers.json`, which is rewritten by
 * `scripts/sync-mcp.mjs` (run locally via `pnpm sync:mcp` or on a daily cron
 * via `.github/workflows/sync-mcp.yml`). Pages MUST go through this module
 * rather than importing the JSON directly so we can swap to a real registry
 * fetch later without touching consumers.
 */

import data from "./mcp-servers.json";

export type McpTransport = "stdio" | "http" | "sse" | "websocket";

/**
 * One concrete way to launch an MCP server. A server can ship multiple
 * launchers (e.g. an `npx` package and a `docker` image) — clients pick
 * the one that matches their environment.
 */
export interface McpInstallSpec {
  /** Friendly label rendered above the command. */
  label: string;
  /** Launcher binary the user must have on PATH (`npx`, `uvx`, `docker`, …). */
  command: "npx" | "uvx" | "docker" | "node" | "python" | "deno" | "bunx";
  /** Args appended to the command, in order. Use `<PLACEHOLDER>` tokens for user-supplied values. */
  args: string[];
  /** Optional environment variables the server requires; values are placeholders. */
  env?: Record<string, string>;
  /** Free-form notes (e.g. "needs Docker Desktop running"). */
  notes?: string;
}

export interface McpServer {
  id: string;
  name: string;
  publisher: string;
  description: string;
  homepage?: string;
  repository?: string;
  transports: McpTransport[];
  tags: string[];
  featured?: boolean;
  /** One or more launchers. The first entry is treated as the recommended one. */
  install?: McpInstallSpec[];
  /** Crawler(s) that produced this entry — `npm`, `officialRepo`, `glama`, etc. */
  sources?: string[];
  /** Original publisher / owner before republishing under `modelcontextprotocol`. */
  originalPublisher?: string;
}

export interface McpRegistrySnapshot {
  syncedAt: string;
  source: string;
  /** Optional canonical URL of the upstream registry. */
  sourceUrl?: string;
  /** Optional list of crawlers that fed this snapshot. */
  sources?: string[];
  servers: McpServer[];
}

const snapshot = data as unknown as McpRegistrySnapshot;

export function getMcpSnapshot(): McpRegistrySnapshot {
  return snapshot;
}

export function listMcpServers(): McpServer[] {
  return snapshot.servers;
}

export function getFeaturedMcpServers(limit = 6): McpServer[] {
  const featured = snapshot.servers.filter((s) => s.featured);
  const rest = snapshot.servers.filter((s) => !s.featured);
  return [...featured, ...rest].slice(0, limit);
}

export function searchMcpServers(query: string): McpServer[] {
  const q = query.toLowerCase().trim();
  if (!q) return snapshot.servers;
  return snapshot.servers.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.publisher.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

/** Look up a single server by its registry id (e.g. `modelcontextprotocol/filesystem`). */
export function getMcpServer(id: string): McpServer | undefined {
  return snapshot.servers.find((s) => s.id === id);
}

/**
 * Best-effort icon URL for an MCP server. Resolution order:
 *   1. GitHub owner avatar derived from `repository` (works for any
 *      github.com-hosted repo, served from a CDN with no rate limit).
 *   2. Favicon of the homepage host via Google's `s2/favicons` service.
 *   3. `null`, in which case the UI should render its built-in fallback icon.
 *
 * Returns `null` rather than throwing so callers can drop straight into JSX.
 */
export function getMcpServerIconUrl(server: McpServer): string | null {
  // Some npm packages publish `repository` as `{ type, url }` rather than a
  // bare string; handle both shapes defensively.
  const rawRepo: unknown = server.repository;
  const repo =
    typeof rawRepo === "string"
      ? rawRepo
      : rawRepo && typeof rawRepo === "object" && "url" in rawRepo
        ? String((rawRepo as { url: unknown }).url ?? "")
        : "";
  const ghMatch = repo.match(
    /(?:github\.com[/:])([^/\s]+)\/([^/\s.]+)(?:\.git)?/i,
  );
  if (ghMatch) {
    const owner = ghMatch[1];
    return `https://github.com/${encodeURIComponent(owner)}.png?size=80`;
  }
  const home = server.homepage;
  if (home) {
    try {
      const host = new URL(home).host;
      if (host) {
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
      }
    } catch {
      /* ignore malformed URL */
    }
  }
  return null;
}

/** Render a single launcher as a one-liner shell command. */
export function renderInstallCommand(spec: McpInstallSpec): string {
  const env = spec.env
    ? Object.entries(spec.env)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") + " "
    : "";
  return `${env}${spec.command} ${spec.args.join(" ")}`.trim();
}

/**
 * Build a JSON snippet suitable for a given MCP client's config file.
 * Returns an object whose top-level key is the server's slug; clients
 * either paste it under their own `mcpServers` (Claude Desktop, Cursor)
 * or `mcp.servers` (VS Code, Windsurf) key.
 */
export function renderClientConfig(
  server: McpServer,
  spec: McpInstallSpec,
): Record<string, unknown> {
  const slug = server.id.split("/").pop() ?? server.id;
  return {
    [slug]: {
      command: spec.command,
      args: spec.args,
      ...(spec.env ? { env: spec.env } : {}),
    },
  };
}
