/**
 * Legacy flat package API. Kept as a compat shim over the new registry so
 * existing pages keep working while we migrate. New code should import from
 * `@/lib/registry` instead.
 *
 * @deprecated use `@/lib/registry`
 */

import { listPublicExtensions, resolveAlias } from "./registry";
import type { Extension } from "./types";

export interface OxpPackage {
  id: string; // canonical scoped id, e.g. "@oxp-core/jupyter-notebook-native"
  legacyId: string;
  title: string;
  publisher: string;
  description: string;
  version: string;
  downloads: string;
  stars: number;
  tags: string[];
  ownerHandle: string;
  slug: string;
  /** Until the runtime ships and authors port their extensions, every entry is
   *  surfaced as `planned` rather than implying it can be installed today. */
  availability: "available" | "planned";
  /** Phase B.8 — publisher trust tier (denormalized on User/Organization). */
  verificationLevel?: "unverified" | "github" | "domain";
  verifiedDomain?: string | null;
  verifiedGithub?: string | null;
}

function toLegacy(ext: Extension): OxpPackage {
  return {
    id: `@${ext.ownerHandle}/${ext.slug}`,
    legacyId: ext.slug,
    title: ext.title,
    publisher: ext.ownerHandle,
    description: ext.description,
    version: ext.latestVersion,
    downloads: ext.downloads,
    stars: ext.stars,
    tags: ext.tags,
    ownerHandle: ext.ownerHandle,
    slug: ext.slug,
    availability: "planned",
  };
}

export const packages: OxpPackage[] = listPublicExtensions().map(toLegacy);

export function getPackageById(id: string): OxpPackage | undefined {
  const exact = packages.find((p) => p.id === id);
  if (exact) return exact;
  const alias = resolveAlias(id);
  if (alias) {
    return packages.find(
      (p) => p.ownerHandle === alias.ownerHandle && p.slug === alias.slug,
    );
  }
  return packages.find((p) => p.slug === id);
}

export function searchPackages(query: string): OxpPackage[] {
  const q = query.toLowerCase().trim();
  if (!q) return packages;
  return packages.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.publisher.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
