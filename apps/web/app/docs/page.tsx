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
