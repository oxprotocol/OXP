import Link from "next/link";
import { docSections, getDocsByCategory } from "@/lib/docs";
import {
  ArrowRight,
  Compass,
  Rocket,
  BookOpen,
  Wrench,
  Shield,
  FileText,
  Sparkles,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const categoryMeta: Record<string, { Icon: LucideIcon; tagline: string }> = {
  Overview: {
    Icon: Compass,
    tagline: "What OXP is and how it fits together.",
  },
  "Getting Started": {
    Icon: Rocket,
    tagline: "Install the CLI and ship your first extension.",
  },
  Fundamentals: {
    Icon: BookOpen,
    tagline: "Manifest, UI, SDK, permissions, bundle, hosts.",
  },
  Techniques: {
    Icon: Wrench,
    tagline: "Rust components, declarative UI, dev workflow, publishing.",
  },
  Security: {
    Icon: Shield,
    tagline: "Sandbox, signing, TOFU pinning, threat model.",
  },
  Reference: {
    Icon: FileText,
    tagline: "CLI flags, registry API, contributing.",
  },
};

export const metadata = { title: "Docs" };

export default function DocsIndexPage() {
  const grouped = getDocsByCategory();
  const first = docSections[0];
  const totalPages = docSections.length;

  return (
    <div className="docs-content max-w-5xl">
      <p className="docs-eyebrow text-sm font-medium uppercase tracking-wider mb-3 inline-flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5" />
        Documentation · v1
      </p>
      <h1 className="docs-h1 text-5xl font-bold tracking-tight mb-4">
        Build extensions for every IDE.
      </h1>
      <p className="docs-lead max-w-2xl text-base leading-7 mb-8">
        The Open eXtension Protocol — one manifest, one bundle, one CLI. Publish
        once, install anywhere. {totalPages} pages cover the spec, the runtime,
        the registry, and everything in between.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-14">
        {first && (
          <Link
            href={`/docs/${first.slug}`}
            className="docs-cta inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-base font-medium"
          >
            Start with {first.title}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
        <Link
          href="/docs/installation"
          className="docs-pager-link inline-flex items-center gap-2 rounded-md border px-5 py-2.5 text-base font-medium"
        >
          Install the CLI
        </Link>
        <Link
          href="/docs/cli-reference"
          className="docs-pager-link inline-flex items-center gap-2 rounded-md border px-5 py-2.5 text-base font-medium"
        >
          CLI reference
        </Link>
      </div>

      {/* ─── MCP Featured Card ─── */}
      <div className="relative rounded-lg overflow-hidden p-[1.5px] mb-10">
        {/* Rotating conic-gradient border */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[200%] aspect-square animate-mcp-border"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg 55%, #7DD3FC 60%, #a78bfa 72%, #7DD3FC 80%, transparent 85%)",
          }}
        />
        <Link
          href="/docs/mcp-integration"
          className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5 rounded-[7px] p-6 group"
          style={{ background: "var(--docs-card-solid-bg)" }}
        >
          <span
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border docs-card-icon"
          >
            <Server className="h-6 w-6" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h2 className="docs-card-title text-lg font-bold tracking-tight">
                Managing MCP Servers
              </h2>
              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold tracking-[0.18em] uppercase bg-[#7DD3FC]/10 text-[#7DD3FC] border border-[#7DD3FC]/20">
                <Sparkles className="h-2.5 w-2.5" />
                New
              </span>
            </div>
            <p className="docs-card-tagline text-sm leading-relaxed">
              OXP acts as a universal MCP router — one command installs any AI
              tool into every client simultaneously. No JSON editing, instant
              rollout across VS Code, JetBrains, Cursor, and Neovim.
            </p>
            <code className="mt-2.5 inline-block text-xs font-mono text-[#7DD3FC]/80 bg-[#7DD3FC]/5 border border-[#7DD3FC]/15 rounded px-3 py-1.5">
              oxp mcp add github
            </code>
          </div>
          <ArrowRight
            className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1"
            style={{ color: "var(--docs-link)" }}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Object.entries(grouped).map(([category, docs]) => {
          const meta = categoryMeta[category] ?? {
            Icon: BookOpen,
            tagline: "",
          };
          const Icon = meta.Icon;
          return (
            <section
              key={category}
              className="docs-card group relative flex flex-col rounded-lg border p-5"
            >
              <header className="mb-3 flex items-center gap-2.5">
                <span className="docs-card-icon inline-flex h-8 w-8 items-center justify-center rounded-md border">
                  <Icon className="h-4 w-4" />
                </span>
                <h2 className="docs-card-title text-base font-semibold tracking-tight">
                  {category}
                </h2>
                <span className="docs-card-count ml-auto rounded px-2 py-0.5 font-mono text-xs">
                  {docs.length}
                </span>
              </header>
              {meta.tagline && (
                <p className="docs-card-tagline mb-3 text-sm leading-6">
                  {meta.tagline}
                </p>
              )}
              <ul className="mt-auto space-y-1">
                {docs.slice(0, 5).map((d) => (
                  <li key={d.slug}>
                    <Link
                      href={`/docs/${d.slug}`}
                      className="docs-card-link inline-flex items-center gap-1.5 text-sm"
                    >
                      <ArrowRight className="h-3 w-3 opacity-60 transition-transform group-hover:translate-x-0.5" />
                      {d.title}
                    </Link>
                  </li>
                ))}
                {docs.length > 5 && (
                  <li className="pl-4.5 text-xs opacity-70">
                    +{docs.length - 5} more
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="docs-card-tagline mt-12 text-sm">
        New to OXP? Read{" "}
        <Link href="/docs/introduction" className="docs-link underline">
          Introduction
        </Link>{" "}
        first, then jump into{" "}
        <Link href="/docs/first-extension" className="docs-link underline">
          Your First Extension
        </Link>
        .
      </p>
    </div>
  );
}
