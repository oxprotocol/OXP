/**
 * Phase B.8 — Publisher verification level (derive + persist).
 *
 * `PublisherVerification` is the source of truth. This module derives a
 * single tier from those rows (`unverified` / `github` / `domain`) and
 * mirrors it onto the matching `User` or `Organization` row so directory
 * surfaces (extension cards, profile pages) can render a badge without
 * an N+1 lookup.
 *
 *   domain     — any active dns_txt verification (highest trust).
 *   github     — any active github_oauth verification.
 *   unverified — neither.
 *
 * Call `recomputePublisherLevel(handle)` after any verify / revoke / expire
 * state change.
 */

import { prisma } from "@/lib/prisma";
import { isReservedBrand } from "@/lib/reserved-handles";
import type { VerificationLevel } from "@prisma/client";

export type PublisherLevel = VerificationLevel;

export interface PublisherTrust {
  level: PublisherLevel;
  /** Set when level > unverified. Earliest verifiedAt across active proofs. */
  verifiedAt: Date | null;
  /** GitHub login if a github_oauth proof is active. */
  githubLogin: string | null;
  /** Apex domain if a dns_txt proof is active. */
  domain: string | null;
  /** True for reserved brand handles (anthropic, microsoft, …). */
  reserved: boolean;
}

export async function getPublisherTrust(
  handle: string,
): Promise<PublisherTrust> {
  const lower = handle.toLowerCase();
  const rows = await prisma.publisherVerification.findMany({
    where: { handle: lower, status: "verified" },
    orderBy: { verifiedAt: "asc" },
  });

  let level: PublisherLevel = "unverified";
  let verifiedAt: Date | null = null;
  let githubLogin: string | null = null;
  let domain: string | null = null;

  for (const r of rows) {
    if (r.method === "dns_txt") {
      level = "domain";
      domain = r.target;
    } else if (r.method === "github_oauth" && level !== "domain") {
      level = "github";
      githubLogin = r.target;
    }
    if (!verifiedAt && r.verifiedAt) verifiedAt = r.verifiedAt;
  }

  return {
    level,
    verifiedAt,
    githubLogin,
    domain,
    reserved: isReservedBrand(lower),
  };
}

/**
 * Recompute the publisher tier for `handle` and persist to whichever of
 * `users` / `organizations` carries it. Safe to call repeatedly; cheap
 * UPDATE if nothing changed.
 */
export async function recomputePublisherLevel(handle: string): Promise<void> {
  const lower = handle.toLowerCase();
  const trust = await getPublisherTrust(lower);

  const updates = [
    prisma.user.updateMany({
      where: { handle: lower },
      data: {
        verificationLevel: trust.level,
        verifiedAt: trust.verifiedAt,
        // Don't clobber githubLogin if a non-active proof previously set it;
        // only overwrite when we have a fresh active value or none.
        ...(trust.githubLogin !== null
          ? { githubLogin: trust.githubLogin }
          : {}),
      },
    }),
    prisma.organization.updateMany({
      where: { handle: lower },
      data: {
        verificationLevel: trust.level,
        verifiedAt: trust.verifiedAt,
        verified: trust.level !== "unverified",
      },
    }),
  ];
  await Promise.all(updates);
}

/**
 * Bulk read for directory listings — returns a Map keyed by lowercase handle.
 * Skips reserved-brand lookups; callers should annotate badges from the static
 * brand list when needed.
 */
export async function getPublisherLevels(
  handles: string[],
): Promise<Map<string, PublisherLevel>> {
  if (handles.length === 0) return new Map();
  const lower = Array.from(new Set(handles.map((h) => h.toLowerCase())));
  const [users, orgs] = await Promise.all([
    prisma.user.findMany({
      where: { handle: { in: lower } },
      select: { handle: true, verificationLevel: true },
    }),
    prisma.organization.findMany({
      where: { handle: { in: lower } },
      select: { handle: true, verificationLevel: true },
    }),
  ]);
  const m = new Map<string, PublisherLevel>();
  for (const u of users) m.set(u.handle.toLowerCase(), u.verificationLevel);
  for (const o of orgs) m.set(o.handle.toLowerCase(), o.verificationLevel);
  return m;
}
