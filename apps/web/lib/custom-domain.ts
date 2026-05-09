/**
 * Custom domain → org handle resolver.
 *
 * Phase 3 — Host-based routing. The middleware calls `resolveCustomDomain`
 * for every incoming request and, when a verified row exists, rewrites
 * unprefixed catalog URLs to the matching `@handle/...` namespace.
 *
 * We cache lookups in-memory for `CACHE_TTL_MS` so we don't hammer Postgres
 * on every static asset. The cache is per-process — fine for our scale and
 * fast to invalidate (60 s).
 */

import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 30_000;

interface CacheEntry {
  handle: string | null;
  exp: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Hostnames that are part of the platform itself and must never be treated
 * as custom domains. Add new platform hosts here.
 */
const PLATFORM_HOST_SUFFIXES = [
  "oxp.sh",
  "vercel.app",
  "localhost",
  "127.0.0.1",
];

export function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  return PLATFORM_HOST_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

/**
 * Resolve a hostname to its owning org handle. Returns null when the
 * hostname is not bound to any org (or is bound but not yet verified).
 */
export async function resolveCustomDomain(
  hostname: string,
): Promise<string | null> {
  const key = hostname.toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.handle;

  const row = await prisma.orgDomain.findUnique({
    where: { hostname: key },
    select: { status: true, orgId: true },
  });

  // Only verified or actively-serving domains route. Pending / failed do not.
  let handle: string | null = null;
  if (row && (row.status === "verified" || row.status === "active")) {
    const org = await prisma.organization.findUnique({
      where: { id: row.orgId },
      select: { handle: true },
    });
    handle = org?.handle ?? null;
  }

  cache.set(key, {
    handle,
    exp: now + (handle ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return handle;
}

/**
 * Drop a hostname from the cache. Call after the admin updates / deletes
 * the OrgDomain row so the change takes effect immediately.
 */
export function invalidateCustomDomain(hostname: string): void {
  cache.delete(hostname.toLowerCase());
}
