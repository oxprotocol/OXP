"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExtensionCard } from "@/components/ui/ExtensionCard";
import { SearchBar } from "@/components/ui/SearchBar";
import type { OxpPackage } from "@/lib/packages";
import {
  getCategories,
  sortPackages,
  SORT_OPTIONS,
  type SortKey,
} from "@/lib/categories";
import { Filter, LayoutGrid, X } from "lucide-react";

const categories = getCategories();

interface Props {
  initialPackages: OxpPackage[];
  /** Override the page heading (defaults to "Browse Extensions"). */
  heading?: string;
  /** Override the eyebrow tag (defaults to "// Registry"). */
  eyebrow?: string;
  /** Override the subtitle line. Plain string so the prop crosses the
   *  server/client boundary cleanly. */
  subtitle?: string;
  /** Replaces the search placeholder. */
  searchPlaceholder?: string;
  /** Optional banner rendered above the heading (e.g. VSX explainer). */
  banner?: React.ReactNode;
}

export function PackagesBrowseClient({
  initialPackages,
  heading = "Browse Extensions",
  eyebrow = "// Registry",
  subtitle,
  searchPlaceholder = "Filter packages by name, tag, or publisher...",
  banner,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("trending");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    let list = q
      ? initialPackages.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.publisher.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : initialPackages;
    if (activeTags.length > 0) {
      list = list.filter((pkg) =>
        activeTags.every((t) => pkg.tags.includes(t)),
      );
    }
    return sortPackages(list, sort);
  }, [query, activeTags, sort, initialPackages]);

  const toggleTag = (slug: string) => {
    setActiveTags((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug],
    );
  };

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-12">
          {banner}
          <div className="flex items-center gap-3 mb-3">
            <LayoutGrid className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {eyebrow}
            </h2>
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[#f8fafc] mb-2">
            {heading}
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40 mb-8">
            {subtitle ??
              `${initialPackages.length} packages across ${categories.length} categories — filter, sort, and install.`}
          </p>
          <SearchBar onSearch={setQuery} placeholder={searchPlaceholder} />
        </div>
      </section>

      <section className="app-container app-shell py-12">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">
          <aside className="space-y-6">
            <div className="hud-card hud-corners p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase flex items-center gap-2">
                  <Filter className="w-3 h-3" />
                  {"// Categories"}
                </h3>
                {activeTags.length > 0 && (
                  <button
                    onClick={() => setActiveTags([])}
                    className="text-[10px] font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC] transition-colors uppercase tracking-wider"
                  >
                    Clear
                  </button>
                )}
              </div>
              <ul className="space-y-1">
                {categories.map((cat) => {
                  const active = activeTags.includes(cat.slug);
                  return (
                    <li key={cat.slug}>
                      <button
                        onClick={() => toggleTag(cat.slug)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-mono transition-all ${
                          active
                            ? "bg-[#7DD3FC]/10 border border-[#7DD3FC]/30 text-[#7DD3FC]"
                            : "border border-transparent text-[#f8fafc]/40 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5"
                        }`}
                      >
                        <span>{cat.label}</span>
                        <span className="text-[10px] opacity-60">
                          {cat.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="hud-card hud-corners p-6">
              <h3 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-4">
                {"// Sort"}
              </h3>
              <ul className="space-y-1">
                {SORT_OPTIONS.map((opt) => (
                  <li key={opt.key}>
                    <button
                      onClick={() => setSort(opt.key)}
                      className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-all ${
                        sort === opt.key
                          ? "bg-[#7DD3FC]/10 border border-[#7DD3FC]/30 text-[#7DD3FC]"
                          : "border border-transparent text-[#f8fafc]/40 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5"
                      }`}
                    >
                      {opt.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <p className="text-xs font-mono text-[#f8fafc]/40">
                <span className="text-[#7DD3FC]">{filtered.length}</span> result
                {filtered.length !== 1 ? "s" : ""}
                {query && ` for "${query}"`}
              </p>
              {activeTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {activeTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleTag(t)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/5 text-[10px] font-mono text-[#7DD3FC] hover:bg-[#7DD3FC]/10 transition-all"
                    >
                      {t}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {filtered.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((pkg) => (
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
                  No extensions match your filters.
                </p>
                <p className="text-[#f8fafc]/15 font-mono text-xs">
                  Try removing a tag or broadening your search.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
