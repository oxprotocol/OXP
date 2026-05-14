/**
 * `oxp mcp` — MCP server management subcommands.
 *
 * Usage:
 *   oxp mcp rollback @publisher/server   Undo config changes made by `oxp install`
 *
 * The rollback command removes the server entry from every detected MCP-aware
 * client (Claude Desktop, Cursor, VS Code, Windsurf). It only touches the
 * server's own key — no other config is modified or removed.
 */

import {
  detectClients,
  removeServerFrom,
  type InstallReport,
} from "../lib/mcp-clients.js";
import { appendMcpLog } from "../lib/mcp-log.js";
import { info } from "../util.js";

const HELP = `oxp mcp <subcommand>

Subcommands:
  oxp mcp rollback @publisher/server   Remove an MCP server from all detected
                                        client configs, undoing \`oxp install\`.

Flags:
  --json   Emit a machine-readable JSON result
  -h       Show this help
`;

export async function mcpCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return 0;
    case "rollback":
      return mcpRollback(rest);
    default:
      process.stderr.write(`oxp mcp: unknown subcommand '${sub}'\n\n` + HELP);
      return 2;
  }
}

async function mcpRollback(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const id = args.find((a) => !a.startsWith("-"));

  if (!id) {
    process.stderr.write(
      `oxp mcp rollback: missing server id\n` +
        `Usage: oxp mcp rollback @publisher/server\n`,
    );
    return 1;
  }

  // Derive the slug that was used as the key in each client's config.
  // e.g.  @modelcontextprotocol/server-github  →  server-github
  const slug = id.split("/").pop()!.replace(/^@/, "");

  const clients = await detectClients();
  const reports: InstallReport[] = [];

  for (const c of clients) {
    const r = await removeServerFrom(c, slug);
    reports.push(r);
    await appendMcpLog({
      kind: "rollback",
      id,
      client: c.id,
      status:
        r.status === "updated"
          ? "ok"
          : r.status === "skipped"
            ? "skipped"
            : "failed",
      reason: r.reason,
    });
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({
        ok: reports.every((r) => r.status !== "failed"),
        kind: "mcp-rollback",
        id,
        slug,
        clients: reports.map((r) => ({
          id: r.client.id,
          name: r.client.displayName,
          configPath: r.client.configPath,
          status: r.status,
          reason: r.reason,
        })),
      }) + "\n",
    );
    return reports.every((r) => r.status !== "failed") ? 0 : 1;
  }

  if (clients.length === 0) {
    info(`oxp mcp rollback: no MCP-aware clients detected`);
    info(
      `  (Claude Desktop, Cursor, VS Code, and Windsurf were all absent)`,
    );
    return 0;
  }

  const removed = reports.filter((r) => r.status === "updated");
  const alreadyGone = reports.filter((r) => r.status === "skipped");
  const failed = reports.filter((r) => r.status === "failed");

  info(`oxp mcp rollback: ${id}`);
  for (const r of removed) {
    info(
      `  ✓ removed from ${r.client.displayName.padEnd(18)}  ${r.client.configPath}`,
    );
  }
  for (const r of alreadyGone) {
    info(`  · ${r.client.displayName} — ${r.reason ?? "not configured"}`);
  }
  for (const r of failed) {
    info(`  ✗ ${r.client.displayName} — ${r.reason ?? "unknown error"}`);
  }

  if (removed.length > 0) {
    info(`  restart the affected client(s) to apply the change.`);
  } else if (failed.length === 0) {
    info(`  server was not configured in any detected client — nothing to undo.`);
  }

  // Log path hint
  info(
    `  log: ~/.oxp/logs/mcp-install.jsonl`,
  );

  return failed.length === 0 ? 0 : 1;
}
