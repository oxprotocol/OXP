"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/ui/SearchBar";
import { ExtensionCard } from "@/components/ui/ExtensionCard";
import { StarField } from "@/components/ui/StarField";
import type { OxpPackage } from "@/lib/packages";
import { getFeaturedMcpServers, getMcpSnapshot } from "@/lib/mcp";
import {
  Rocket,
  Zap,
  Shield,
  Terminal,
  ArrowRight,
  Activity,
  Plug,
  Server,
  Sparkles,
  Layers,
  Radio,
  Edit3,
  PanelsTopLeft,
} from "lucide-react";

import { BrandIcon, type BrandIconName } from "@/components/brand/BrandIcon";

// Compatible IDEs/editors for the marquee strip.
// All marks are inlined SVGs (from simple-icons, CC0) that inherit
// `currentColor`, so the whole row renders in a uniform monochrome
// (Neon-style trusted-by strip).
const IDES: { name: string; icon: BrandIconName }[] = [
  { name: "VS Code", icon: "vscode" },
  { name: "Cursor", icon: "cursor" },
  { name: "Windsurf", icon: "windsurf" },
  { name: "JetBrains", icon: "jetbrains" },
  { name: "Neovim", icon: "neovim" },
];

export default function Home() {
  const [allPackages, setAllPackages] = useState<OxpPackage[]>([]);
  const [filteredPackages, setFilteredPackages] = useState<OxpPackage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Pull DB-backed extensions from the public API on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/extensions?limit=24&kind=native")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.items) return;
        // Map API response to OxpPackage shape used by the card.
        const items = j.items as OxpPackage[];
        setAllPackages(items);
        setFilteredPackages(items);
      })
      .catch((err) => console.error("[home] failed to load extensions:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    const q = query.toLowerCase().trim();
    setFilteredPackages(
      !q
        ? allPackages
        : allPackages.filter(
            (p) =>
              p.title.toLowerCase().includes(q) ||
              p.publisher.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q) ||
              p.tags.some((t) => t.toLowerCase().includes(q)),
          ),
    );
  };

  return (
    <div data-force-dark className="flex flex-col flex-1 w-full">
      <StarField />

      {/* ─── HERO SECTION ─── */}
      <section
        className="relative w-full overflow-hidden scan-line-overlay"
        style={{ zIndex: 2 }}
      >
        {/* Radial glow behind hero (dark only) */}
        <div className="absolute inset-0 pointer-events-none hero-glow">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-[#7DD3FC]/[0.03] blur-[120px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-28 md:py-40 flex flex-col items-center text-center">
          {/* Status badge */}
          <div className="flex items-center gap-2 mb-8 px-4 py-2 rounded-full border border-[#7DD3FC]/15 bg-[#7DD3FC]/5 animate-flicker">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-beacon" />
            <span className="text-[10px] font-mono tracking-[0.2em] text-[#7DD3FC]/70 uppercase">
              Runtime v0.1 shipped · VS Code · JetBrains · Neovim
            </span>
          </div>

          {/* Title */}
          <h1 className="text-5xl md:text-8xl font-black tracking-tight text-[#f8fafc] mb-6 max-w-5xl leading-[0.9]">
            The last extension you&apos;ll{" "}
            <span className="text-holo">ever port</span>.
          </h1>

          <p className="text-base md:text-lg text-[#f8fafc]/40 mb-14 max-w-2xl leading-relaxed font-mono">
            OXP is an open protocol for IDE extensions. Write once. Ship to
            every editor, forever.
          </p>

          {/* Search */}
          <div className="w-full flex justify-center mb-8">
            <SearchBar onSearch={handleSearch} />
          </div>

          {/* Popular tags */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-mono">
            <span className="text-[#f8fafc]/20 tracking-wider uppercase">
              Popular:
            </span>
            {["react", "python", "themes", "git", "ai", "jupyter"].map(
              (tag) => (
                <button
                  key={tag}
                  onClick={() => handleSearch(tag)}
                  className="px-3 py-1 rounded border border-[#7DD3FC]/10 text-[#f8fafc]/30 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/30 hover:bg-[#7DD3FC]/5 transition-all duration-300"
                >
                  {tag}
                </button>
              ),
            )}
          </div>
        </div>
      </section>

      {/* ─── IDE MARQUEE + FACTS STRIP ─── */}
      <IdeMarqueeStrip />

      {/* ─── SHIPPING NEXT ─ Wave 2 capabilities ─── */}
      <ShippingNextStrip />

      {/* ─── FEATURE CARDS ─── */}
      {!searchQuery && (
        <section
          className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 w-full"
          style={{ zIndex: 2 }}
        >
          {/* Section header */}
          <div className="flex items-center gap-4 mb-6">
            <div className="h-[1px] flex-1 bg-gradient-to-r from-[#7DD3FC]/20 to-transparent" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.3em] text-[#7DD3FC]/50 uppercase whitespace-nowrap">
              {"// Why OXP"}
            </h2>
            <div className="h-[1px] flex-1 bg-gradient-to-l from-[#7DD3FC]/20 to-transparent" />
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-[#f8fafc] text-center mb-16 leading-[1.05] max-w-4xl mx-auto">
            The problem is 30 years old.{" "}
            <span className="text-holo">We just solved it.</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* For Developers Card */}
            <div className="hud-card hud-corners p-10 group">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5">
                  <Rocket className="w-5 h-5 text-[#7DD3FC]" />
                </div>
                <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase">
                  Portability
                </h2>
              </div>

              <h3 className="text-2xl md:text-3xl font-black text-[#f8fafc] mb-4 leading-tight">
                One bundle. Every editor. No compromises.
              </h3>

              <p className="text-[#f8fafc]/35 text-sm font-mono mb-8 leading-relaxed">
                You wrote it once. It runs everywhere. Not mostly everywhere or
                with a few tweaks — everywhere. The .oxp runtime is a contract,
                not a suggestion.
              </p>

              <ul className="space-y-3 mb-8">
                {[
                  { icon: Zap, text: "Zero background processes" },
                  { icon: Terminal, text: "Universal API surface" },
                  {
                    icon: Activity,
                    text: "Portable across every conformant runtime",
                  },
                ].map(({ icon: Icon, text }) => (
                  <li
                    key={text}
                    className="flex items-center gap-3 text-sm text-[#f8fafc]/50 font-mono"
                  >
                    <Icon className="w-3.5 h-3.5 text-[#7DD3FC]/50 flex-shrink-0" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/docs"
                className="inline-flex items-center gap-2 text-xs font-mono font-bold text-[#7DD3FC] hover:text-[#BAE6FD] transition-colors tracking-wider uppercase group/link"
              >
                Read the docs
                <ArrowRight className="w-3 h-3 group-hover/link:translate-x-1 transition-transform" />
              </Link>
            </div>

            {/* For IDEs Card */}
            <div className="hud-card hud-corners p-10 group">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5">
                  <Shield className="w-5 h-5 text-[#7DD3FC]" />
                </div>
                <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase">
                  Modern Stack
                </h2>
              </div>

              <h3 className="text-2xl md:text-3xl font-black text-[#f8fafc] mb-4 leading-tight">
                Your stack. Not ours.
              </h3>

              <p className="text-[#f8fafc]/35 text-sm font-mono mb-8 leading-relaxed">
                React, Vite, Tailwind. The tools you already know. No
                proprietary APIs to memorize, no XML to hand-roll, no webview
                hacks to maintain. Just code.
              </p>

              <ul className="space-y-3 mb-8">
                {[
                  { icon: Shield, text: "Sandboxed micro-frontends" },
                  {
                    icon: Terminal,
                    text: "Declarative permissions (oxp.config.ts)",
                  },
                  { icon: Zap, text: "60fps native rendering" },
                ].map(({ icon: Icon, text }) => (
                  <li
                    key={text}
                    className="flex items-center gap-3 text-sm text-[#f8fafc]/50 font-mono"
                  >
                    <Icon className="w-3.5 h-3.5 text-[#7DD3FC]/50 flex-shrink-0" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/docs/architecture"
                className="inline-flex items-center gap-2 text-xs font-mono font-bold text-[#7DD3FC] hover:text-[#BAE6FD] transition-colors tracking-wider uppercase group/link"
              >
                Explore the engine
                <ArrowRight className="w-3 h-3 group-hover/link:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>

          {/* Build-an-extension CTA — two-step path so users don't just
              copy a CLI snippet and hit `unknown command`. Step 1 reserves
              the slug on the registry, step 2 scaffolds locally. */}
          <div className="mt-12 mx-auto max-w-2xl">
            <div className="grid sm:grid-cols-2 gap-3">
              {/* Step 1 — Reserve */}
              <Link
                href="/new"
                className="hud-card hud-corners group px-5 py-4 flex items-center justify-between hover:border-[#7DD3FC]/40 transition-colors"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="flex h-7 w-7 items-center justify-center rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/5 text-[10px] font-mono font-bold text-[#7DD3FC]">
                    1
                  </div>
                  <div>
                    <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#7DD3FC]/60">
                      Reserve a slug
                    </div>
                    <div className="text-sm font-mono text-[#f8fafc]/70">
                      @you/your-extension
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#7DD3FC]/40 group-hover:translate-x-1 group-hover:text-[#7DD3FC] transition-all" />
              </Link>

              {/* Step 2 — Scaffold locally */}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText("npx @oxprotocol/cli create my-extension")
                    .catch(() => {});
                }}
                className="hud-card hud-corners group px-5 py-4 flex items-center justify-between text-left hover:border-[#7DD3FC]/40 transition-colors"
                title="Copy command"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/5 text-[10px] font-mono font-bold text-[#7DD3FC]">
                    2
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#7DD3FC]/60">
                      Scaffold locally
                    </div>
                    <code className="block text-sm font-mono text-[#f8fafc]/70 truncate">
                      <span className="text-[#7DD3FC]/40">$</span> npx
                      @oxprotocol/cli create my-ext
                    </code>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-[#f8fafc]/30 tracking-wider uppercase border border-[#7DD3FC]/10 px-2 py-1 rounded group-hover:text-[#7DD3FC] group-hover:border-[#7DD3FC]/30 flex-shrink-0">
                  Copy
                </span>
              </button>
            </div>
            <p className="mt-3 text-center text-[10px] font-mono text-[#f8fafc]/30 tracking-wider">
              <Link
                href="/docs/getting-started"
                className="hover:text-[#7DD3FC] transition-colors"
              >
                Full getting-started guide →
              </Link>
            </p>
          </div>
        </section>
      )}

      {/* ─── EXTENSIONS GRID ─── */}
      <section className="relative py-24" style={{ zIndex: 2 }}>
        {/* Top border accent */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#7DD3FC]/15 to-transparent" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section header */}
          <div className="flex items-end justify-between mb-12">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Activity className="w-4 h-4 text-[#7DD3FC]/40" />
                <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                  {searchQuery ? `// Search Results` : `// Trending Extensions`}
                </h2>
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-[#f8fafc]">
                {searchQuery
                  ? `${filteredPackages.length} result${filteredPackages.length !== 1 ? "s" : ""} for "${searchQuery}"`
                  : "What the community is building"}
              </h3>
            </div>
            {!searchQuery && (
              <Link
                href="/packages"
                className="hidden sm:flex items-center gap-2 text-[10px] font-mono font-bold text-[#7DD3FC]/50 hover:text-[#7DD3FC] transition-colors tracking-wider uppercase group"
              >
                View all
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </Link>
            )}
          </div>

          {/* Grid */}
          {filteredPackages.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {filteredPackages.map((pkg) => (
                <Link
                  key={pkg.id}
                  href={`/${pkg.ownerHandle}/${pkg.slug}`}
                  className="block"
                >
                  <ExtensionCard
                    name={pkg.title}
                    author={`@${pkg.ownerHandle}`}
                    description={pkg.description}
                    version={pkg.version}
                    downloads={pkg.downloads}
                    stars={pkg.stars}
                    availability={pkg.availability}
                    tags={pkg.tags}
                    verificationLevel={pkg.verificationLevel}
                    verifiedDomain={pkg.verifiedDomain}
                    verifiedGithub={pkg.verifiedGithub}
                  />
                </Link>
              ))}
            </div>
          ) : (
            <div className="hud-card hud-corners p-16 text-center">
              <p className="text-[#f8fafc]/30 font-mono text-sm mb-2">
                No extensions found matching &quot;{searchQuery}&quot;
              </p>
              <p className="text-[#f8fafc]/15 font-mono text-xs">
                Try a different search term or browse all extensions
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ─── FEATURED MCP SERVERS ─── */}
      {!searchQuery && <FeaturedMcpSection />}

      {/* ─── CTA SECTION ─── */}
      {!searchQuery && (
        <section className="relative py-24" style={{ zIndex: 2 }}>
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#7DD3FC]/15 to-transparent" />

          <div className="max-w-3xl mx-auto px-4 text-center">
            <h2 className="text-3xl md:text-5xl font-black text-[#f8fafc] mb-6 leading-tight">
              The extension ecosystem just{" "}
              <span className="text-holo">changed</span>.
            </h2>
            <p className="text-sm font-mono text-[#f8fafc]/35 mb-10 max-w-lg mx-auto leading-relaxed">
              Be the first to build on it.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-8 py-3 bg-[#7DD3FC] text-[#060a13] font-mono font-bold text-sm tracking-wider uppercase rounded hover:bg-[#BAE6FD] hover:shadow-[0_0_30px_rgba(125, 211, 252,0.25)] transition-all duration-300"
              >
                <Rocket className="w-4 h-4" />
                Get Started
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 px-8 py-3 border border-[#7DD3FC]/20 text-[#f8fafc]/50 font-mono font-bold text-sm tracking-wider uppercase rounded hover:border-[#7DD3FC]/50 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5 transition-all duration-300"
              >
                Read the Docs
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function IdeMarqueeStrip() {
  const snapshot = getMcpSnapshot();
  const facts = [
    {
      value: snapshot.servers.length.toLocaleString(),
      label: "MCP Servers",
    },
    { value: IDES.length.toString(), label: "Compatible IDEs" },
    { value: "Open", label: "Protocol" },
    { value: "Built in", label: "Europe" },
  ];

  // Duplicate the IDE list so the marquee loops seamlessly.
  const lane = [...IDES, ...IDES];

  return (
    <section
      className="relative border-y border-[#7DD3FC]/10 bg-[#060a13]/80 backdrop-blur-sm"
      style={{ zIndex: 2 }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
        {/* Facts row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {facts.map((f) => (
            <div key={f.label} className="text-center">
              <div className="text-2xl md:text-3xl font-black font-mono text-[#7DD3FC] mb-1">
                {f.value}
              </div>
              <div className="text-[10px] font-mono tracking-[0.2em] text-[#f8fafc]/30 uppercase">
                {f.label}
              </div>
            </div>
          ))}
        </div>

        {/* IDE marquee — monochrome wordmark + glyph row, Neon-style */}
        <div className="marquee-mask overflow-hidden -mx-4 sm:-mx-6 lg:-mx-8">
          <div className="animate-marquee flex items-center gap-14 w-max px-4">
            {lane.map((ide, i) => (
              <div
                key={`${ide.name}-${i}`}
                className="flex items-center gap-3 text-[#f8fafc]/45 hover:text-[#f8fafc]/85 transition-colors duration-300 shrink-0"
              >
                <BrandIcon name={ide.icon} className="w-7 h-7" />
                <span className="text-base font-bold tracking-tight whitespace-nowrap">
                  {ide.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturedMcpSection() {
  const featured = getFeaturedMcpServers(6);
  const snapshot = getMcpSnapshot();

  return (
    <section className="relative py-24" style={{ zIndex: 2 }}>
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#7DD3FC]/15 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-12 gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <Server className="w-4 h-4 text-[#7DD3FC]/40" />
              <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
                {"// MCP Library"}
              </h2>
            </div>
            <h3 className="text-3xl md:text-4xl font-black text-[#f8fafc] mb-3 leading-tight">
              {snapshot.servers.length.toLocaleString()} AI tools.{" "}
              <span className="text-holo">One command.</span>
            </h3>
            <p className="text-sm font-mono text-[#f8fafc]/40 max-w-2xl leading-relaxed">
              Every MCP server ever published, indexed daily. While everyone
              else edits JSON config files, your users type one command.
            </p>
          </div>
          <Link
            href="/mcp"
            className="inline-flex items-center gap-2 text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 hover:text-[#7DD3FC] transition-colors uppercase"
          >
            Browse MCP Library
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {featured.map((server) => (
            <Link
              key={server.id}
              href="/mcp"
              className="hud-card hud-corners p-6 flex flex-col group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5 text-[#7DD3FC] group-hover:border-[#7DD3FC]/40 transition-all">
                    <Plug className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-base font-mono font-bold text-[#7DD3FC] mb-0.5 group-hover:text-[#BAE6FD] transition-colors">
                      {server.name}
                    </h4>
                    <p className="text-[10px] font-mono text-[#f8fafc]/30 tracking-wider uppercase">
                      @{server.publisher}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/10 text-[#7DD3FC]/80 text-[9px] font-mono font-bold tracking-[0.18em] uppercase">
                  <Sparkles className="w-2.5 h-2.5" />
                  Featured
                </div>
              </div>
              <p className="text-[#f8fafc]/50 flex-1 text-xs mb-5 line-clamp-3 leading-relaxed font-mono">
                {server.description}
              </p>
              <div className="flex items-center gap-1.5 mt-auto pt-4 border-t border-[#7DD3FC]/10">
                {server.transports.map((t) => (
                  <span
                    key={t}
                    className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-[#7DD3FC]/15 text-[#7DD3FC]/60 bg-[#7DD3FC]/5 tracking-wider uppercase"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Shipping Next ──────────────────────────────────────────────
// v0.1 (the runtime + 3 hosts) is live. The capabilities below are
// the next protocol slice ("Wave 2") — already specified in WIT, in
// active integration on all three hosts. We surface them here so
// users see the trajectory without committing to specific dates.
const SHIPPING_NEXT: { icon: typeof Layers; title: string; blurb: string }[] = [
  {
    icon: PanelsTopLeft,
    title: "Native UI surfaces",
    blurb:
      "ui/render painted into real tool windows on JetBrains and floating windows on Neovim. Same component vocabulary, native pixels.",
  },
  {
    icon: Radio,
    title: "Streams",
    blurb:
      "Long-running stream/* RPCs for log tailing, build output, and incremental search — backpressure-aware on every host.",
  },
  {
    icon: Edit3,
    title: "editor/* APIs",
    blurb:
      "Read selections, apply edits, decorate ranges, and register code lenses through one editor contract that lowers to each host's native API.",
  },
  {
    icon: Layers,
    title: "surface/register",
    blurb:
      "Declarative panel + view registration. One manifest entry, native chrome on every editor.",
  },
];

function ShippingNextStrip() {
  return (
    <section
      className="relative border-b border-[#7DD3FC]/10 bg-[#060a13]/60"
      style={{ zIndex: 2 }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center gap-4 mb-8">
          <div className="h-[1px] flex-1 bg-gradient-to-r from-[#7DD3FC]/20 to-transparent" />
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[#7DD3FC]/20 bg-[#7DD3FC]/5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#7DD3FC] animate-beacon" />
            <span className="text-[10px] font-mono font-bold tracking-[0.3em] text-[#7DD3FC]/70 uppercase whitespace-nowrap">
              Shipping next
            </span>
          </div>
          <div className="h-[1px] flex-1 bg-gradient-to-l from-[#7DD3FC]/20 to-transparent" />
        </div>
        <h3 className="text-2xl md:text-4xl font-black text-[#f8fafc] text-center mb-3 leading-tight">
          v0.1 is live.{" "}
          <span className="text-holo">v0.2 is already in flight.</span>
        </h3>
        <p className="text-sm font-mono text-[#f8fafc]/40 text-center max-w-2xl mx-auto mb-12 leading-relaxed">
          Specified in WIT. Implemented on all three hosts. Rolling out as soon
          as conformance tests go green — no waiting on a 2027 milestone.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {SHIPPING_NEXT.map(({ icon: Icon, title, blurb }) => (
            <div
              key={title}
              className="hud-card hud-corners p-5 flex flex-col gap-3"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5 text-[#7DD3FC]">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] font-mono font-bold tracking-[0.18em] text-[#7DD3FC]/80 uppercase">
                  {title}
                </span>
              </div>
              <p className="text-xs font-mono text-[#f8fafc]/45 leading-relaxed">
                {blurb}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
