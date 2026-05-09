/**
 * GET /api/v1/install/mcp/:scope/:slug
 *   → { ok: true, kind: "mcp", id, name, description, install: McpInstallSpec[], homepage?, repository? }
 *
 * Used by `oxp install <id>` CLI to fetch the launcher spec for an MCP
 * server. The CLI then merges it into every detected MCP-aware client
 * config (Claude Desktop, Cursor, VS Code Copilot, Windsurf, JetBrains).
 *
 * No auth required — the registry data is public.
 */

import { NextResponse } from "next/server";
import { getMcpServer } from "@/lib/mcp";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ scope: string; slug: string }> },
): Promise<Response> {
  const { scope, slug } = await ctx.params;
  if (!scope || !slug) {
    return NextResponse.json(
      { ok: false, error: "missing scope or slug" },
      { status: 400 },
    );
  }
  // mcp-servers.json keys are `{publisher}/{slug}` without the leading "@".
  const id = `${scope}/${slug}`;
  const server = getMcpServer(id);
  if (!server) {
    return NextResponse.json(
      { ok: false, error: `mcp server not found: @${id}` },
      { status: 404 },
    );
  }
  if (!server.install || server.install.length === 0) {
    return NextResponse.json(
      { ok: false, error: `no install spec for @${id}` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    kind: "mcp",
    id: `@${id}`,
    name: server.name,
    description: server.description,
    homepage: server.homepage,
    repository: server.repository,
    transports: server.transports,
    install: server.install,
  });
}
