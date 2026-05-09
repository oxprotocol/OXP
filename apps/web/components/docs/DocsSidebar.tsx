"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { getDocsByCategory } from "@/lib/docs";

export function DocsSidebar() {
  const pathname = usePathname();
  const grouped = getDocsByCategory();
  const activeSlug = pathname?.startsWith("/docs/")
    ? pathname.replace("/docs/", "").split("/")[0]
    : "";

  return (
    <nav className="docs-sidebar text-base" aria-label="Documentation">
      {Object.entries(grouped).map(([category, docs]) => (
        <Category
          key={category}
          name={category}
          docs={docs}
          activeSlug={activeSlug}
        />
      ))}
    </nav>
  );
}

function Category({
  name,
  docs,
  activeSlug,
}: {
  name: string;
  docs: { slug: string; title: string }[];
  activeSlug: string;
}) {
  // Default: only "Overview" open. Any other category that contains the
  // active doc auto-opens so the user always sees where they are.
  const containsActive = docs.some((d) => d.slug === activeSlug);
  const [open, setOpen] = useState(name === "Overview" || containsActive);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="docs-sidebar-cat flex w-full items-center justify-between rounded px-3 py-2 text-left text-base font-semibold tracking-wide"
      >
        <span>{name}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <ul className="mt-0.5 mb-2 space-y-px">
          {docs.map((d) => {
            const active = d.slug === activeSlug;
            return (
              <li key={d.slug}>
                <Link
                  href={`/docs/${d.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={`docs-sidebar-link block rounded px-3 py-2 text-base ${
                    active ? "is-active" : ""
                  }`}
                >
                  {d.title}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
