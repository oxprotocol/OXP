import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Code2,
  ExternalLink,
  Plug,
  Server,
  Sparkles,
  Terminal,
} from "lucide-react";
import { CodeBlock } from "@/components/docs/CodeBlock";
import { McpClientConfig } from "@/components/mcp/McpClientConfig";
import {
  getMcpServer,
  renderInstallCommand,
  type McpInstallSpec,
  type McpServer,
} from "@/lib/mcp";

export const dynamic = "force-static";

/**
 * MCP server detail page. Routes like `/mcp/modelcontextprotocol/filesystem`
 * land here via the catch-all segment. We show:
 *   - identity + description + transports
 *   - one or more launchers as ready-to-paste shell commands
 *   - client config snippets for the popular MCP-aware clients
 *   - links back to the upstream repo / homepage
 */
export default async function McpServerDetailPage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id } = await params;
  const fullId = id.join("/");
  const server = getMcpServer(fullId);
  if (!server) notFound();

  const launchers: McpInstallSpec[] = server.install ?? [];

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {/* Header */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-10">
          <Link
            href="/mcp"
            className="inline-flex items-center gap-2 text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase mb-6 hover:text-[#7DD3FC] transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            MCP Library
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-start gap-4 min-w-0">
              <div className="p-3 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5 text-[#7DD3FC] shrink-0">
                <Plug className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="w-4 h-4 text-[#7DD3FC]/40" />
                  <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                    {"// MCP Server"}
                  </h2>
                  {server.featured && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/10 text-[#7DD3FC]/80 text-[9px] font-mono font-bold tracking-[0.18em] uppercase">
                      <Sparkles className="w-2.5 h-2.5" />
                      Featured
                    </span>
                  )}
                </div>
                <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc] mb-2">
                  {server.name}
                </h1>
                <p className="text-xs font-mono text-[#f8fafc]/40 mb-4 tracking-wider uppercase">
                  @{server.publisher} · {server.id}
                </p>
                <p className="text-sm font-mono text-[#f8fafc]/60 max-w-2xl leading-relaxed">
                  {server.description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {server.repository && (
                <a
                  href={server.repository}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded border border-[#7DD3FC]/15 text-[#f8fafc]/70 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30 transition text-xs font-mono font-bold tracking-wider uppercase"
                >
                  <Code2 className="w-3.5 h-3.5" /> Source
                </a>
              )}
              {server.homepage && (
                <a
                  href={server.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded border border-[#7DD3FC]/15 text-[#f8fafc]/70 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30 transition text-xs font-mono font-bold tracking-wider uppercase"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Homepage
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-6">
            {server.transports.map((t) => (
              <span
                key={t}
                className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-[#7DD3FC]/15 text-[#7DD3FC]/60 bg-[#7DD3FC]/5 tracking-wider uppercase"
              >
                {t}
              </span>
            ))}
            {server.tags.map((t) => (
              <span
                key={t}
                className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-[#f8fafc]/10 text-[#f8fafc]/40 tracking-wider uppercase"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Install + Connect */}
      <section className="app-container app-shell py-12 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-10">
          {/* Run locally */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Terminal className="w-4 h-4 text-[#7DD3FC]/40" />
              <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                {"// Run locally"}
              </h2>
            </div>
            {launchers.length === 0 ? (
              <div className="hud-card hud-corners p-6 text-xs font-mono text-[#f8fafc]/40 leading-relaxed">
                This server hasn’t published a launcher yet. Visit the
                repository for setup instructions.
              </div>
            ) : (
              <div className="space-y-6">
                {launchers.map((spec) => (
                  <LauncherBlock key={spec.label} server={server} spec={spec} />
                ))}
              </div>
            )}
          </div>

          {/* Connect to a client */}
          {launchers.length > 0 && (
            <McpClientConfig server={server} launchers={launchers} />
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="hud-card hud-corners p-5">
            <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-3">
              {"// What is MCP?"}
            </h3>
            <p className="text-xs font-mono text-[#f8fafc]/50 leading-relaxed mb-3">
              The Model Context Protocol is an open spec for plugging tools and
              data sources into LLM agents. Each server runs locally (or over
              HTTP) and exposes a typed tool/resource interface that any
              MCP-aware client can call.
            </p>
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-mono text-[#7DD3FC] hover:text-[#BAE6FD] inline-flex items-center gap-1"
            >
              Learn more <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="hud-card hud-corners p-5">
            <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-3">
              {"// Compatible clients"}
            </h3>
            <ul className="text-xs font-mono text-[#f8fafc]/60 space-y-1.5">
              <li>· Claude Desktop</li>
              <li>· Cursor</li>
              <li>· VS Code (Copilot)</li>
              <li>· Windsurf</li>
              <li>· OXP-aware IDEs</li>
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}

function LauncherBlock({
  server,
  spec,
}: {
  server: McpServer;
  spec: McpInstallSpec;
}) {
  const cmd = renderInstallCommand(spec);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/70 uppercase">
          {spec.label}
        </p>
        <p className="text-[10px] font-mono text-[#f8fafc]/30 uppercase tracking-wider">
          requires {spec.command}
        </p>
      </div>
      <CodeBlock
        code={cmd}
        lang="bash"
        filename={`${server.name} · ${spec.command}`}
      />
      {spec.env && Object.keys(spec.env).length > 0 && (
        <div className="mt-2 text-[10px] font-mono text-[#f8fafc]/40 leading-relaxed">
          Required env:{" "}
          {Object.keys(spec.env).map((k, i) => (
            <span key={k}>
              {i > 0 ? ", " : ""}
              <code className="text-[#7DD3FC]/70">{k}</code>
            </span>
          ))}
        </div>
      )}
      {spec.notes && (
        <p className="mt-2 text-[10px] font-mono text-[#f8fafc]/40 leading-relaxed">
          {spec.notes}
        </p>
      )}
    </div>
  );
}
