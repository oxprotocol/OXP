/**
 * OXP Documentation — data source.
 *
 * Every docs page, sidebar, TOC, and dynamic route reads from this module.
 * Content is split across `docs/` sub-modules for maintainability; this
 * file re-exports the unified `docSections` array and lookup helpers.
 */

import { overviewDocs } from "./docs/overview";
import { gettingStartedDocs } from "./docs/getting-started";
import { fundamentalsDocs } from "./docs/fundamentals";
import { techniquesDocs } from "./docs/techniques";
import { securityDocs } from "./docs/security";
import { referenceDocs } from "./docs/reference";

// ── Types ──────────────────────────────────────────────────────────────

export interface DocSection {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
}

export interface DocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

// ── Content ────────────────────────────────────────────────────────────

export const docSections: DocSection[] = [
  ...overviewDocs,
  ...gettingStartedDocs,
  ...fundamentalsDocs,
  ...techniquesDocs,
  ...securityDocs,
  ...referenceDocs,
];

// ── Lookups ────────────────────────────────────────────────────────────

export function getDocBySlug(slug: string): DocSection | undefined {
  return docSections.find((d) => d.slug === slug);
}

export function getDocsByCategory(): Record<string, DocSection[]> {
  const grouped: Record<string, DocSection[]> = {};
  for (const doc of docSections) {
    (grouped[doc.category] ??= []).push(doc);
  }
  return grouped;
}

// ── Heading extraction (for TOC) ───────────────────────────────────────

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function extractHeadings(body: string): DocHeading[] {
  const headings: DocHeading[] = [];
  for (const line of body.split("\n")) {
    const m2 = /^##\s+(.+)$/.exec(line);
    if (m2) {
      headings.push({ id: slugifyHeading(m2[1]), text: m2[1], level: 2 });
      continue;
    }
    const m3 = /^###\s+(.+)$/.exec(line);
    if (m3) {
      headings.push({ id: slugifyHeading(m3[1]), text: m3[1], level: 3 });
    }
  }
  return headings;
}
