/**
 * Open VSX live metadata fetcher.
 *
 * Mirrored entries store a slim `oxp-vsx-meta` block in their readme so the
 * detail page can render install commands offline. For trust signals
 * (rating, last published, license, verified, real download count) we
 * fetch the live record from open-vsx.org with a 1h Next.js data cache.
 *
 * Why live instead of importing once: trust signals decay. A 6-month-old
 * "verified ✓" snapshot would be a lie. The hourly revalidate keeps the
 * surface honest without hammering Open VSX.
 */

export interface OpenVsxLive {
  namespace: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  /** ISO timestamp of the latest publish. */
  timestamp?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  bugs?: string;
  averageRating?: number | null;
  reviewCount?: number;
  /** True when the publisher namespace is verified by Open VSX. */
  verified?: boolean;
  downloadCount?: number;
  files?: {
    download?: string;
    icon?: string;
    sha256?: string;
    readme?: string;
    changelog?: string;
    license?: string;
    manifest?: string;
  };
  categories?: string[];
}

const BASE = "https://open-vsx.org/api";

export async function fetchOpenVsxLive(
  namespace: string,
  name: string,
): Promise<OpenVsxLive | null> {
  try {
    const res = await fetch(`${BASE}/${namespace}/${name}`, {
      headers: {
        accept: "application/json",
        "user-agent": "oxp.sh registry/1.0",
      },
      // Next.js fetch cache — 1h revalidate.
      next: { revalidate: 3600, tags: [`openvsx:${namespace}/${name}`] },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as OpenVsxLive;
    return j;
  } catch {
    return null;
  }
}

/**
 * Fetch the README markdown that Open VSX hosts for a release.
 * Returns null on any failure so callers can fall back to the link CTA.
 */
export async function fetchOpenVsxReadme(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "text/plain, text/markdown, */*" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Cap to keep page payload reasonable.
    return text.length > 64_000 ? text.slice(0, 64_000) + "\n\n…" : text;
  } catch {
    return null;
  }
}
