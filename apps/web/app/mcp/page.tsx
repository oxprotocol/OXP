"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Code2,
  ExternalLink,
  Plug,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import { SearchBar } from "@/components/ui/SearchBar";
import {
  getMcpServerIconUrl,
  getMcpSnapshot,
  searchMcpServers,
  type McpServer,
} from "@/lib/mcp";

const snapshot = getMcpSnapshot();

// ---- Filter facets -----------------------------------------------------
// Tags we surface as one-click filters. Curated from the most common
// non-noise tags in the snapshot — `npm`, `mcp`, `mcp-server`, etc. are
// almost universal and would not narrow results, so they are excluded.
const FILTER_TAGS = [
  "ai",
  "claude",
  "cursor",
  "memory",
  "search",
  "security",
  "browser-automation",
  "email",
  "cli",
  "typescript",
  "agent",
  "api",
] as const;

const TRANSPORTS = ["stdio", "http", "sse", "websocket"] as const;
const SOURCES: { id: string; label: string }[] = [
  { id: "officialRepo", label: "Official repo" },
  { id: "npm", label: "npm" },
  { id: "registry", label: "Registry" },
  { id: "glama", label: "Glama" },
  { id: "mcpso", label: "mcp.so" },
];

function ServerCard({ server }: { server: McpServer }) {
  const installable = (server.install?.length ?? 0) > 0;
  const iconUrl = getMcpServerIconUrl(server);
  return (
    <Link
      href={`/mcp/${server.id}`}
      className="hud-card hud-corners p-6 flex flex-col h-full group hover:border-[#7DD3FC]/40 transition-colors"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5 text-[#7DD3FC] group-hover:border-[#7DD3FC]/40 transition-all overflow-hidden flex items-center justify-center w-9 h-9 shrink-0">
            {iconUrl ? (
              // Plain <img> — third-party hosts (GitHub avatars, Google
              // favicon proxy) aren't whitelisted in next.config.ts and
              // wrapping every card in next/image would force us to.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconUrl}
                alt=""
                width={28}
                height={28}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-7 h-7 rounded-sm object-cover"
                onError={(e) => {
                  // Fall back to the Plug glyph by hiding the broken image.
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                  const sib = (e.currentTarget as HTMLImageElement)
                    .nextElementSibling as HTMLElement | null;
                  if (sib) sib.style.display = "block";
                }}
              />
            ) : null}
            <Plug
              className="w-5 h-5"
              style={{ display: iconUrl ? "none" : "block" }}
            />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-mono font-bold text-[#7DD3FC] mb-0.5 truncate">
              {server.name}
            </h3>
            <p className="text-[10px] font-mono text-[#f8fafc]/30 tracking-wider uppercase truncate">
              @{server.originalPublisher ?? server.publisher}
            </p>
          </div>
        </div>
        {server.featured && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/10 text-[#7DD3FC]/80 text-[9px] font-mono font-bold tracking-[0.18em] uppercase shrink-0">
            <Sparkles className="w-2.5 h-2.5" />
            Featured
          </div>
        )}
      </div>

      <p className="text-[#f8fafc]/50 flex-1 text-xs mb-6 line-clamp-3 leading-relaxed font-mono">
        {server.description || "No description provided."}
      </p>

      <div className="flex items-center justify-between mt-auto pt-4 border-t border-[#7DD3FC]/10 gap-3">
        <div className="flex flex-wrap gap-1.5">
          {server.transports.map((t) => (
            <span
              key={t}
              className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-[#7DD3FC]/15 text-[#7DD3FC]/60 bg-[#7DD3FC]/5 tracking-wider uppercase"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[#f8fafc]/30">
          {server.repository && (
            <span
              className="hover:text-[#7DD3FC] transition-colors"
              aria-label={`${server.name} repository`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(server.repository, "_blank", "noopener,noreferrer");
              }}
              role="link"
              tabIndex={0}
            >
              <Code2 className="w-3.5 h-3.5" />
            </span>
          )}
          {server.homepage && (
            <span
              className="hover:text-[#7DD3FC] transition-colors"
              aria-label={`${server.name} homepage`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(server.homepage, "_blank", "noopener,noreferrer");
              }}
              role="link"
              tabIndex={0}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </div>

      {installable && (
        <div className="mt-4 pt-3 border-t border-[#7DD3FC]/10 flex items-center justify-between text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/70 uppercase group-hover:text-[#7DD3FC] transition-colors">
          <span>Connect</span>
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      )}
    </Link>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  count?: number;
  onToggle: () => void;
}
function FilterChip({ label, active, count, onToggle }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded border tracking-wider uppercase transition-colors ${
        active
          ? "border-[#7DD3FC]/60 bg-[#7DD3FC]/15 text-[#7DD3FC]"
          : "border-[#7DD3FC]/15 bg-[#7DD3FC]/5 text-[#7DD3FC]/50 hover:border-[#7DD3FC]/40 hover:text-[#7DD3FC]/80"
      }`}
    >
      {label}
      {typeof count === "number" && (
        <span className="ml-1.5 text-[#f8fafc]/30 font-normal">{count}</span>
      )}
    </button>
  );
}

const PAGE_SIZE = 36;

export default function McpRegistryPage() {
  const [query, setQuery] = useState("");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [installableOnly, setInstallableOnly] = useState(false);
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set());
  const [activeTransports, setActiveTransports] = useState<Set<string>>(
    new Set(),
  );
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Pre-compute facet counts on the *unfiltered* snapshot so the chip
  // numbers don't shrink to 0 as the user narrows the result set.
  const facetCounts = useMemo(() => {
    const sources: Record<string, number> = {};
    const transports: Record<string, number> = {};
    const tags: Record<string, number> = {};
    for (const s of snapshot.servers) {
      for (const src of s.sources ?? []) sources[src] = (sources[src] ?? 0) + 1;
      for (const t of s.transports) transports[t] = (transports[t] ?? 0) + 1;
      for (const t of s.tags) tags[t] = (tags[t] ?? 0) + 1;
    }
    return { sources, transports, tags };
  }, []);

  const filtered = useMemo<McpServer[]>(() => {
    let list = query ? searchMcpServers(query) : snapshot.servers;
    if (featuredOnly) list = list.filter((s) => s.featured);
    if (installableOnly)
      list = list.filter((s) => (s.install?.length ?? 0) > 0);
    if (activeSources.size > 0)
      list = list.filter((s) =>
        (s.sources ?? []).some((src) => activeSources.has(src)),
      );
    if (activeTransports.size > 0)
      list = list.filter((s) =>
        s.transports.some((t) => activeTransports.has(t)),
      );
    if (activeTags.size > 0)
      list = list.filter((s) => s.tags.some((t) => activeTags.has(t)));
    return [...list].sort((a, b) => {
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [
    query,
    featuredOnly,
    installableOnly,
    activeSources,
    activeTransports,
    activeTags,
  ]);

  const featuredCount = snapshot.servers.filter((s) => s.featured).length;
  const activeFilterCount =
    (featuredOnly ? 1 : 0) +
    (installableOnly ? 1 : 0) +
    activeSources.size +
    activeTransports.size +
    activeTags.size;

  function toggle(set: Set<string>, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function clearAllFilters() {
    setFeaturedOnly(false);
    setInstallableOnly(false);
    setActiveSources(new Set());
    setActiveTransports(new Set());
    setActiveTags(new Set());
    setVisible(PAGE_SIZE);
  }

  // Reset the windowed paginator whenever the filtered set changes, so the
  // user always sees the top of the new result set.
  const visibleSlice = filtered.slice(0, visible);
  const canLoadMore = visible < filtered.length;

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {/* Header */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-12">
          <div className="flex items-center gap-3 mb-3">
            <Server className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// MCP Library"}
            </h2>
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[#f8fafc] mb-3">
            Every MCP server, in one place.
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40 mb-8 max-w-2xl leading-relaxed">
            A live mirror of the public Model Context Protocol registry. New
            servers are pulled automatically — connect any of them to an
            OXP-compatible IDE through the MCP Connector.
          </p>
          <SearchBar
            onSearch={(q) => {
              setQuery(q);
              setVisible(PAGE_SIZE);
            }}
            placeholder="Search MCP servers by name, publisher, or tag..."
          />
        </div>
      </section>

      {/* Filters */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/40">
        <div className="app-container app-shell py-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Filters"}
              {activeFilterCount > 0 && (
                <span className="ml-2 text-[#7DD3FC]">
                  ({activeFilterCount} active)
                </span>
              )}
            </h3>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex items-center gap-1 text-[10px] font-mono font-bold tracking-wider uppercase text-[#f8fafc]/40 hover:text-[#7DD3FC] transition-colors"
              >
                <X className="w-3 h-3" />
                Clear all
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-[#f8fafc]/30 uppercase mr-1">
              Quick:
            </span>
            <FilterChip
              label="Featured"
              active={featuredOnly}
              count={featuredCount}
              onToggle={() => {
                setFeaturedOnly((v) => !v);
                setVisible(PAGE_SIZE);
              }}
            />
            <FilterChip
              label="Installable"
              active={installableOnly}
              count={
                snapshot.servers.filter((s) => (s.install?.length ?? 0) > 0)
                  .length
              }
              onToggle={() => {
                setInstallableOnly((v) => !v);
                setVisible(PAGE_SIZE);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-[#f8fafc]/30 uppercase mr-1">
              Source:
            </span>
            {SOURCES.filter((s) => (facetCounts.sources[s.id] ?? 0) > 0).map(
              (s) => (
                <FilterChip
                  key={s.id}
                  label={s.label}
                  count={facetCounts.sources[s.id]}
                  active={activeSources.has(s.id)}
                  onToggle={() => {
                    setActiveSources((prev) => toggle(prev, s.id));
                    setVisible(PAGE_SIZE);
                  }}
                />
              ),
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-[#f8fafc]/30 uppercase mr-1">
              Transport:
            </span>
            {TRANSPORTS.filter((t) => (facetCounts.transports[t] ?? 0) > 0).map(
              (t) => (
                <FilterChip
                  key={t}
                  label={t}
                  count={facetCounts.transports[t]}
                  active={activeTransports.has(t)}
                  onToggle={() => {
                    setActiveTransports((prev) => toggle(prev, t));
                    setVisible(PAGE_SIZE);
                  }}
                />
              ),
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-[#f8fafc]/30 uppercase mr-1">
              Tag:
            </span>
            {FILTER_TAGS.filter((t) => (facetCounts.tags[t] ?? 0) > 0).map(
              (t) => (
                <FilterChip
                  key={t}
                  label={t}
                  count={facetCounts.tags[t]}
                  active={activeTags.has(t)}
                  onToggle={() => {
                    setActiveTags((prev) => toggle(prev, t));
                    setVisible(PAGE_SIZE);
                  }}
                />
              ),
            )}
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="app-container app-shell py-12">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {query || activeFilterCount > 0
                ? `// Results (${filtered.length})`
                : "// All Servers"}
            </h2>
          </div>
          {filtered.length > 0 && (
            <span className="text-[10px] font-mono text-[#f8fafc]/30 tracking-wider uppercase">
              Showing {Math.min(visible, filtered.length)} / {filtered.length}
            </span>
          )}
        </div>

        {filtered.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleSlice.map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
            {canLoadMore && (
              <div className="flex justify-center mt-10">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="px-5 py-2.5 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/5 text-[#7DD3FC] hover:bg-[#7DD3FC]/15 hover:border-[#7DD3FC]/60 text-[11px] font-mono font-bold tracking-[0.2em] uppercase transition-colors"
                >
                  Load more ({filtered.length - visible} remaining)
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="hud-card hud-corners p-16 text-center">
            <p className="text-[#f8fafc]/30 font-mono text-sm mb-2">
              No MCP servers match your filters
              {query ? ` and "${query}"` : ""}.
            </p>
            <p className="text-[#f8fafc]/15 font-mono text-xs">
              Try removing a filter or clearing the search.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
