/**
 * Phase B.1 — Publisher verification (DNS TXT method).
 *
 * Flow:
 *   1. User starts a challenge for `(handle, domain)`.
 *      → server creates a `PublisherVerification` row with a fresh 256-bit
 *        token and a 7-day deadline. Token is shown ONCE.
 *   2. User publishes a TXT record at `_oxp-challenge.<domain>` with the
 *      token as the value.
 *   3. User triggers verification.
 *      → server resolves TXT records and checks for an exact match.
 *      → on match: status flips to `verified`, `verifiedAt` is set.
 *      → on miss: status stays `pending` (retry allowed) until `expiresAt`.
 *
 * The DNS resolver is injectable so unit tests don't hit the network.
 */

import { randomBytes } from "node:crypto";
import { resolveTxt as nodeResolveTxt } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { findReservedBrand } from "@/lib/reserved-handles";
import type { PublisherVerification } from "@prisma/client";

/** Subdomain on which the TXT record must be published. */
export const CHALLENGE_HOST_PREFIX = "_oxp-challenge";

/** Validity window for an unverified challenge. */
export const CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** RFC 1035-ish apex domain pattern. Lowercase, no scheme, no path. */
const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type DnsResolver = (host: string) => Promise<string[][]>;

/** Production resolver: Node's `dns/promises.resolveTxt`. */
export const defaultResolver: DnsResolver = nodeResolveTxt;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

export function challengeHost(domain: string): string {
  return `${CHALLENGE_HOST_PREFIX}.${domain}`;
}

/** The exact TXT value the user must publish. */
export function challengeRecord(token: string): string {
  return `oxp-verify=${token}`;
}

/**
 * Create a new DNS-TXT challenge for `(handle, domain)`. If a pending
 * challenge already exists for that pair, returns it (idempotent — UI can
 * call this on every page load).
 */
export async function createDnsChallenge(input: {
  handle: string;
  domain: string;
  createdByUserId: string;
}): Promise<PublisherVerification> {
  const handle = input.handle.toLowerCase();
  const domain = input.domain.toLowerCase().trim();

  if (!isValidDomain(domain)) {
    throw new Error(`invalid domain: ${domain}`);
  }

  // For brand-reserved handles, the domain MUST match the canonical one.
  // Anyone can verify `@randomdev` against any of their own domains, but
  // `@microsoft` can only be claimed via `microsoft.com`.
  const brand = findReservedBrand(handle);
  if (brand && brand.domain !== domain) {
    throw new Error(
      `handle @${handle} is reserved for ${brand.domain}; cannot verify against ${domain}`,
    );
  }

  const existing = await prisma.publisherVerification.findUnique({
    where: {
      handle_method_target: { handle, method: "dns_txt", target: domain },
    },
  });
  if (
    existing &&
    existing.status === "pending" &&
    existing.expiresAt > new Date()
  ) {
    return existing;
  }

  // Replace stale rows so the user always has at most one active challenge
  // per (handle, domain). `upsert` works because of the unique index.
  const token = randomBytes(32).toString("hex");
  return prisma.publisherVerification.upsert({
    where: {
      handle_method_target: { handle, method: "dns_txt", target: domain },
    },
    create: {
      handle,
      method: "dns_txt",
      target: domain,
      token,
      status: "pending",
      createdByUserId: input.createdByUserId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
    update: {
      token,
      status: "pending",
      createdByUserId: input.createdByUserId,
      verifiedAt: null,
      revokedAt: null,
      reason: null,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
}

export interface VerifyResult {
  ok: boolean;
  /** Updated row. */
  verification: PublisherVerification;
  /** Records observed at the challenge host (joined per RDATA group). */
  observedRecords: string[];
}

/**
 * Run the DNS check for an existing challenge. Updates the row in place.
 * Caller must check `verification.status` afterwards.
 */
export async function checkDnsChallenge(
  verificationId: string,
  resolver: DnsResolver = defaultResolver,
): Promise<VerifyResult> {
  const v = await prisma.publisherVerification.findUnique({
    where: { id: verificationId },
  });
  if (!v) throw new Error(`verification ${verificationId} not found`);
  if (v.method !== "dns_txt") {
    throw new Error(`verification ${verificationId} is not a DNS challenge`);
  }
  if (v.status === "verified" || v.status === "revoked") {
    return {
      ok: v.status === "verified",
      verification: v,
      observedRecords: [],
    };
  }
  if (v.expiresAt < new Date()) {
    const expired = await prisma.publisherVerification.update({
      where: { id: v.id },
      data: { status: "expired", reason: "challenge ttl elapsed" },
    });
    return { ok: false, verification: expired, observedRecords: [] };
  }

  const expected = challengeRecord(v.token);
  let records: string[] = [];
  try {
    const grouped = await resolver(challengeHost(v.target));
    // Each TXT record can be split across multiple character-strings; join.
    records = grouped.map((parts) => parts.join(""));
  } catch (err) {
    const updated = await prisma.publisherVerification.update({
      where: { id: v.id },
      data: { reason: `dns lookup failed: ${(err as Error).message}` },
    });
    return { ok: false, verification: updated, observedRecords: [] };
  }

  if (records.includes(expected)) {
    const verified = await prisma.publisherVerification.update({
      where: { id: v.id },
      data: { status: "verified", verifiedAt: new Date(), reason: null },
    });
    // Mirror the verified flag onto the Organization row if one exists with
    // the same handle. Users don't have a `verified` column today; the
    // existence of the verification row is the source of truth there.
    await prisma.organization
      .updateMany({ where: { handle: v.handle }, data: { verified: true } })
      .catch(() => {});
    return { ok: true, verification: verified, observedRecords: records };
  }

  const updated = await prisma.publisherVerification.update({
    where: { id: v.id },
    data: {
      reason: `expected ${expected} at ${challengeHost(v.target)}; observed ${
        records.length
      } record(s)`,
    },
  });
  return { ok: false, verification: updated, observedRecords: records };
}

/**
 * Is this handle verified by ANY active proof? Used to show the badge.
 */
export async function isHandleVerified(handle: string): Promise<boolean> {
  const row = await prisma.publisherVerification.findFirst({
    where: { handle: handle.toLowerCase(), status: "verified" },
    select: { id: true },
  });
  return row !== null;
}

/** List active verifications for a handle (for the dashboard / badge tooltip). */
export async function listVerifications(
  handle: string,
): Promise<PublisherVerification[]> {
  return prisma.publisherVerification.findMany({
    where: { handle: handle.toLowerCase() },
    orderBy: { createdAt: "desc" },
  });
}
