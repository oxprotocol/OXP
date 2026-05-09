/**
 * Phase B.6 — Abuse / rate-limiting controls.
 *
 * In-process sliding-window limiter. Good enough for single-instance
 * deployments and CI; swap for Redis-backed counters when we go
 * multi-region. The API surface stays the same.
 *
 * Keys are caller-defined strings — typically `"publish:<tokenId>"` for
 * the publish endpoint or `"signup:<ip>"` for signup. The limiter is
 * intentionally agnostic about what they mean.
 *
 * Limits chosen to match ROADMAP-SECURITY.md § Phase B.6:
 *   - publish: 10 / hour / token (default)
 *   - signup:  5  / hour / IP    (default)
 */

const WINDOWS = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Milliseconds until the oldest hit in the window expires. */
  retryAfterMs: number;
  limit: number;
}

/**
 * Record one hit against `key` and return whether it's allowed.
 *
 * @param key        opaque caller-chosen identifier
 * @param limit      max hits allowed in the window
 * @param windowMs   sliding-window duration
 * @param now        injectable for tests; defaults to Date.now()
 */
export function consume(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;
  const hits = (WINDOWS.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    const oldest = hits[0]!;
    WINDOWS.set(key, hits); // keep pruned list
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
      limit,
    };
  }

  hits.push(now);
  WINDOWS.set(key, hits);
  return {
    ok: true,
    remaining: limit - hits.length,
    retryAfterMs: 0,
    limit,
  };
}

/** Inspect without recording. Useful for surfacing remaining quota. */
export function peek(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;
  const hits = (WINDOWS.get(key) ?? []).filter((t) => t > cutoff);
  return {
    ok: hits.length < limit,
    remaining: Math.max(0, limit - hits.length),
    retryAfterMs:
      hits.length >= limit ? Math.max(0, hits[0]! + windowMs - now) : 0,
    limit,
  };
}

/** Reset a key (test helper / admin override). */
export function reset(key?: string): void {
  if (key) WINDOWS.delete(key);
  else WINDOWS.clear();
}

// ─── Conventional limits ────────────────────────────────────────────────────
export const LIMITS = {
  /** Publish endpoint: 10 versions per token per hour. */
  publish: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** Signup: 5 accounts per IP per hour. */
  signup: { limit: 5, windowMs: 60 * 60 * 1000 },
} as const;

/** Extract a best-effort client IP from common reverse-proxy headers. */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("x-real-ip") || headers.get("cf-connecting-ip") || "unknown"
  );
}

/**
 * Build standard rate-limit response headers (RFC 6585 + draft-ietf-httpapi).
 */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "x-ratelimit-limit": String(r.limit),
    "x-ratelimit-remaining": String(r.remaining),
  };
  if (!r.ok) {
    h["retry-after"] = String(Math.ceil(r.retryAfterMs / 1000));
  }
  return h;
}
