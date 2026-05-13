"use client";

import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { CodeBlock } from "@/components/docs/CodeBlock";
import {
  renderClientConfig,
  type McpInstallSpec,
  type McpServer,
} from "@/lib/mcp";

type ClientId = "claude" | "cursor" | "vscode" | "windsurf" | "oxp";

interface ClientPreset {
  id: ClientId;
  label: string;
  /** Where the snippet should be pasted. */
  filename: string;
  /**
   * Wrap the per-server stanza in the right top-level shape for the
   * target client (Claude/Cursor use `mcpServers`, VS Code uses
   * `mcp.servers` inside settings, etc.).
   */
  wrap: (entry: Record<string, unknown>) => Record<string, unknown>;
  /** Path/instructions where the user should paste the snippet. */
  hint: string;
}

const CLIENTS: ClientPreset[] = [
  {
    id: "oxp",
    label: "OXP",
    filename: "terminal",
    wrap: (entry) => entry,
    hint: "Installs the server and configures every detected MCP-aware client (Claude Desktop, Cursor, VS Code, Windsurf) automatically.",
  },
  {
    id: "claude",
    label: "Claude Desktop",
    filename: "claude_desktop_config.json",
    wrap: (entry) => ({ mcpServers: entry }),
    hint: "macOS: ~/Library/Application Support/Claude/claude_desktop_config.json · Windows: %APPDATA%\\Claude\\claude_desktop_config.json",
  },
  {
    id: "cursor",
    label: "Cursor",
    filename: "~/.cursor/mcp.json",
    wrap: (entry) => ({ mcpServers: entry }),
    hint: "Project-scoped: <repo>/.cursor/mcp.json · Global: ~/.cursor/mcp.json",
  },
  {
    id: "vscode",
    label: "VS Code",
    filename: ".vscode/mcp.json",
    wrap: (entry) => ({ servers: entry }),
    hint: "Workspace: <repo>/.vscode/mcp.json · enable via the `chat.mcp.discovery` setting.",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    filename: "~/.codeium/windsurf/mcp_config.json",
    wrap: (entry) => ({ mcpServers: entry }),
    hint: "Edit ~/.codeium/windsurf/mcp_config.json (Settings → Cascade → MCP).",
  },
];

export function McpClientConfig({
  server,
  launchers,
}: {
  server: McpServer;
  launchers: McpInstallSpec[];
}) {
  const [client, setClient] = useState<ClientId>("oxp");
  const [launcherIdx, setLauncherIdx] = useState(0);

  const launcher = launchers[Math.min(launcherIdx, launchers.length - 1)];
  const preset = CLIENTS.find((c) => c.id === client) ?? CLIENTS[0];

  // OXP manages config automatically — single command, no JSON.
  const isOxp = preset.id === "oxp";
  const oxpCommand = `oxp install @modelcontextprotocol/${server.id.split("/").pop()}`;

  const snippet = useMemo(() => {
    if (isOxp) return oxpCommand;
    const entry = renderClientConfig(server, launcher);
    return JSON.stringify(preset.wrap(entry), null, 2);
  }, [server, launcher, preset, isOxp, oxpCommand]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Layers className="w-4 h-4 text-[#7DD3FC]/40" />
        <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
          {"// Connect to a client"}
        </h2>
      </div>

      {/* Client tabs */}
      <div className="flex flex-wrap gap-1 mb-4">
        {CLIENTS.map((c) => {
          const active = c.id === client;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setClient(c.id)}
              className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase transition border ${
                active
                  ? "border-[#7DD3FC]/50 bg-[#7DD3FC]/10 text-[#7DD3FC]"
                  : "border-[#7DD3FC]/10 text-[#f8fafc]/50 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Launcher selector (only when >1, and not for OXP) */}
      {!isOxp && launchers.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {launchers.map((l, i) => {
            const active = i === launcherIdx;
            return (
              <button
                key={l.label}
                type="button"
                onClick={() => setLauncherIdx(i)}
                className={`px-2 py-1 rounded text-[9px] font-mono font-bold tracking-wider uppercase transition border ${
                  active
                    ? "border-[#7DD3FC]/40 text-[#7DD3FC]"
                    : "border-[#f8fafc]/10 text-[#f8fafc]/40 hover:text-[#7DD3FC]"
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      )}

      <CodeBlock
        code={snippet}
        lang={isOxp ? "bash" : "json"}
        filename={isOxp ? "terminal" : preset.filename}
      />
      <p className="mt-2 text-[10px] font-mono text-[#f8fafc]/40 leading-relaxed">
        {isOxp
          ? "OXP manages MCP server configuration automatically — installs the server, wires it into every detected MCP-aware client, and keeps it up to date."
          : preset.hint}
      </p>
    </div>
  );
}
