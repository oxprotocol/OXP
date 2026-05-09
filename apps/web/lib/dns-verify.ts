/**
 * DNS TXT verification for custom domains.
 *
 * To prove ownership of `acme.example`, the customer must publish a TXT
 * record at `_oxp-verify.acme.example` whose value matches the
 * `verifyToken` we generated. We do a live `dns.resolveTxt` lookup; the
 * record may have N strings concatenated, so we join and compare.
 *
 * No third-party deps — uses Node's built-in resolver.
 */

import { promises as dns } from "node:dns";

const RECORD_PREFIX = "_oxp-verify.";

export interface VerifyResult {
  ok: boolean;
  /** Records actually observed at the lookup name (joined per-rrset). */
  observed: string[];
  /** Human-readable error if !ok. */
  error?: string;
}

export function verifyRecordName(hostname: string): string {
  return RECORD_PREFIX + hostname.toLowerCase();
}

/** Validate a hostname is a real DNS name (RFC 1123, lowercase, ≤253 chars). */
export function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (host.startsWith(".") || host.endsWith(".")) return false;
  if (host.startsWith("-") || host.endsWith("-")) return false;
  // require at least one dot (no localhost-style)
  if (!host.includes(".")) return false;
  // each label 1..63 chars
  return host.split(".").every((l) => l.length >= 1 && l.length <= 63);
}

export async function verifyDomainTxt(
  hostname: string,
  expectedToken: string,
): Promise<VerifyResult> {
  const name = verifyRecordName(hostname);
  let records: string[][];
  try {
    records = await dns.resolveTxt(name);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      return {
        ok: false,
        observed: [],
        error: `No TXT record at ${name}. Add: TXT "${expectedToken}"`,
      };
    }
    return {
      ok: false,
      observed: [],
      error: `DNS lookup failed: ${err.code ?? "unknown"}`,
    };
  }
  const joined = records.map((r) => r.join(""));
  const ok = joined.some((v) => v.trim() === expectedToken);
  return ok
    ? { ok: true, observed: joined }
    : {
        ok: false,
        observed: joined,
        error: `TXT record found but does not match. Expected: ${expectedToken}`,
      };
}

/**
 * Block hostnames we will never serve (eat-our-own-tail, public suffixes,
 * loopback, RFC1918-style names). We don't ship the full PSL — these are
 * the obvious ones. Edge proxy enforces the rest at routing time.
 */
const BLOCKED_HOST_SUFFIXES = [
  "oxp.sh",
  "oxprotocol.com",
  "localhost",
  "internal",
  "local",
];

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return BLOCKED_HOST_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
}
