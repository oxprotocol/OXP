import { packages } from "./packages";

export interface Category {
  slug: string;
  label: string;
  count: number;
}

export function getCategories(): Category[] {
  const counts = new Map<string, number>();
  for (const pkg of packages) {
    for (const tag of pkg.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([slug, count]) => ({
      slug,
      label: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

export type SortKey = "trending" | "downloads" | "stars" | "newest" | "name";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "downloads", label: "Most Downloaded" },
  { key: "stars", label: "Most Starred" },
  { key: "newest", label: "Recently Updated" },
  { key: "name", label: "Name (A–Z)" },
];

function parseDownloads(value: string): number {
  const num = parseFloat(value);
  if (value.toLowerCase().includes("m")) return num * 1_000_000;
  if (value.toLowerCase().includes("k")) return num * 1_000;
  return num;
}

export function sortPackages<
  T extends {
    downloads: string;
    stars: number;
    title: string;
    version: string;
  },
>(list: T[], sort: SortKey): T[] {
  const copy = [...list];
  switch (sort) {
    case "downloads":
      return copy.sort(
        (a, b) => parseDownloads(b.downloads) - parseDownloads(a.downloads),
      );
    case "stars":
      return copy.sort((a, b) => b.stars - a.stars);
    case "name":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "newest":
      return copy.sort((a, b) => b.version.localeCompare(a.version));
    case "trending":
    default:
      return copy.sort(
        (a, b) =>
          parseDownloads(b.downloads) * 0.5 +
          b.stars * 5 -
          (parseDownloads(a.downloads) * 0.5 + a.stars * 5),
      );
  }
}
