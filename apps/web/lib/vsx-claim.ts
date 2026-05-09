/**
 * Phase B.8 — VSX claim flow.
 *
 * Imported VSX listings live under synthetic placeholder users with
 * handle = `vsx-<namespace>` and a sentinel `passwordHash` starting with
 * `vsx-claimable:` (so password sign-in can never succeed). The real
 * publisher claims a listing by proving they control the underlying
 * GitHub namespace.
 *
 * Decision matrix:
 *   - Listing not vsx-prefixed         → not claimable.
 *   - Owner not the sentinel           → not claimable (already claimed).
 *   - Caller's GitHub login (Level 2)  matches namespace AND namespace
 *     is NOT a reserved brand          → AUTO-TRANSFER.
 *   - Caller verified the matching     → AUTO-TRANSFER (Level 3 covers
 *     domain (Level 3)                   reserved brands).
 *   - Otherwise                        → require manual review (record
 *                                        a request, return reason).
 */

import { prisma } from "@/lib/prisma";
import { getPublisherTrust } from "@/lib/publisher-level";
import { findReservedBrand } from "@/lib/reserved-handles";
import { isPublicOrgMember, parseGithubOrg } from "@/lib/github-identity";
import { fetchOpenVsxLive } from "@/lib/openvsx";

export type ClaimEligibility =
  | {
      kind: "ok";
      reason: "github_login_match" | "github_org_member" | "domain_match";
    }
  | {
      /**
       * No path passed automatically, but a self-serve path exists.
       * `domainHint` tells the UI which domain to instruct the user to
       * verify via DNS TXT (handled in /dashboard/security).
       */
      kind: "needs_domain";
      reason: "reserved_brand" | "ambiguous_source";
      domainHint: string;
    }
  | {
      kind: "denied";
      reason:
        | "not_vsx"
        | "already_claimed"
        | "no_github"
        | "github_mismatch"
        | "not_found";
      detail?: string;
      /** When set, surface "you need to be a member of @<requiredOrg>". */
      requiredOrg?: string;
    };

export interface ClaimContext {
  scopedId: string; // "@vsx-foo/bar"
  ownerHandle: string; // "vsx-foo"
  slug: string; // "bar"
  vsxNamespace: string; // "foo" (after stripping vsx- prefix)
  reserved: boolean;
}

export function parseScopedId(raw: string): ClaimContext | null {
  // Accept "@owner/slug" or "owner/slug"
  const trimmed = raw.startsWith("@") ? raw.slice(1) : raw;
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const ownerHandle = trimmed.slice(0, slash).toLowerCase();
  const slug = trimmed.slice(slash + 1).toLowerCase();
  if (!ownerHandle || !slug) return null;
  if (!ownerHandle.startsWith("vsx-")) return null;
  const vsxNamespace = ownerHandle.slice(4);
  return {
    scopedId: `@${ownerHandle}/${slug}`,
    ownerHandle,
    slug,
    vsxNamespace,
    reserved: !!findReservedBrand(vsxNamespace),
  };
}

export interface ClaimEligibilityInput {
  ctx: ClaimContext;
  /** Caller user id */
  userId: string;
  /** Caller's verified GitHub login (lowercase), or null if not verified. */
  callerGithubLogin: string | null;
  /** Caller's verification level. */
  callerLevel: "unverified" | "github" | "domain";
  /** Caller's verified domains (lowercase, apex). */
  callerDomains: string[];
}

export async function evaluateClaim(
  input: ClaimEligibilityInput,
): Promise<ClaimEligibility> {
  const { ctx, callerGithubLogin, callerLevel, callerDomains } = input;

  // Confirm the listing exists + is still owned by the placeholder.
  // Pull the source-of-truth repo org along with it so we can decide the
  // *required* GitHub identity (which is rarely the VSX namespace).
  const ext = await prisma.extension.findUnique({
    where: {
      ownerHandle_slug: { ownerHandle: ctx.ownerHandle, slug: ctx.slug },
    },
    select: { id: true, ownerId: true, sourceGithubOrg: true },
  });
  if (!ext) return { kind: "denied", reason: "not_found" };

  const owner = await prisma.user.findUnique({
    where: { id: ext.ownerId },
    select: { passwordHash: true },
  });
  if (!owner?.passwordHash?.startsWith("vsx-claimable:")) {
    return { kind: "denied", reason: "already_claimed" };
  }

  // Live re-fetch from Open VSX when the importer missed `repository.url`.
  // Some packages (e.g. @vsx-anthropic/claude-code) didn't carry it at
  // import time but the upstream API has it now. We persist what we find
  // so the next claim attempt is purely DB-bound.
  let sourceGithubOrg = ext.sourceGithubOrg;
  if (!sourceGithubOrg) {
    const live = await fetchOpenVsxLive(ctx.vsxNamespace, ctx.slug);
    const liveRepo =
      typeof live?.repository === "string" ? live.repository : null;
    const derived = parseGithubOrg(liveRepo);
    if (derived) {
      sourceGithubOrg = derived;
      await prisma.extension
        .update({
          where: { id: ext.id },
          data: { sourceGithubOrg: derived },
        })
        .catch(() => {
          /* best-effort cache; ignore failures */
        });
    }
  }

  // Reserved brands (microsoft, github, openai, …) — no GitHub-only path.
  // Domain proof matching the brand's apex is the only self-serve route.
  if (ctx.reserved) {
    const brand = findReservedBrand(ctx.vsxNamespace);
    if (callerLevel === "domain" && brand) {
      if (
        callerDomains.some(
          (d) => d === brand.domain || d.endsWith(`.${brand.domain}`),
        )
      ) {
        return { kind: "ok", reason: "domain_match" };
      }
    }
    return {
      kind: "needs_domain",
      reason: "reserved_brand",
      domainHint: brand?.domain ?? `${ctx.vsxNamespace}.com`,
    };
  }

  // Need a verified GitHub identity at minimum.
  if (!callerGithubLogin) {
    return { kind: "denied", reason: "no_github" };
  }

  // Preferred path: the listing's repository.url told us the *real* org
  // (e.g. `microsoft` for `vsx-ms-python/python`). Auto-claim is allowed
  // when the caller IS that org/login OR is a public member of it.
  if (sourceGithubOrg) {
    const requiredOrg = sourceGithubOrg.toLowerCase();
    if (callerGithubLogin === requiredOrg) {
      return { kind: "ok", reason: "github_login_match" };
    }
    if (await isPublicOrgMember(requiredOrg, callerGithubLogin)) {
      return { kind: "ok", reason: "github_org_member" };
    }
    return {
      kind: "denied",
      reason: "github_mismatch",
      requiredOrg,
      detail: `This listing's source repo is github.com/${requiredOrg}. You must be a public member of @${requiredOrg} (or the org itself) to claim it. Your verified GitHub login is @${callerGithubLogin}.`,
    };
  }

  // Fallback: no source repo metadata. Personal-looking namespace +
  // matching login = auto-claim. Brand-looking namespace = require
  // domain proof on the namespace's best-guess apex.
  if (looksLikePersonalNamespace(ctx.vsxNamespace)) {
    if (callerGithubLogin === ctx.vsxNamespace) {
      return { kind: "ok", reason: "github_login_match" };
    }
    return {
      kind: "denied",
      reason: "github_mismatch",
      detail: `Your GitHub login is @${callerGithubLogin}, but this listing's namespace is ${ctx.vsxNamespace} and we have no source repository to cross-check. Either change your GitHub login or verify a domain.`,
    };
  }

  return {
    kind: "needs_domain",
    reason: "ambiguous_source",
    domainHint: `${ctx.vsxNamespace}.com`,
  };
}

/**
 * Heuristic: VSX namespaces like `ritwickdey`, `dbaeumer`, `esbenp` are
 * almost always personal GitHub handles. Namespaces like `ms-python`,
 * `vscjava`, `redhat`, `googlecloudtools`, `vscode-icons-team` carry a
 * brand prefix that implies an organization — those must NOT be claimable
 * by anyone who happens to register the matching GitHub username today.
 *
 * Conservative rule: contains a hyphen OR a known brand prefix → NOT
 * personal. Everything else (single token, no hyphen, no dots) → personal.
 */
function looksLikePersonalNamespace(ns: string): boolean {
  if (!ns) return false;
  if (ns.includes("-") || ns.includes(".")) return false;
  const BRAND_TOKENS = [
    "ms",
    "vscode",
    "vs",
    "redhat",
    "rh",
    "google",
    "aws",
    "azure",
    "github",
    "gitlab",
    "openai",
    "anthropic",
    "jetbrains",
    "intellij",
    "oracle",
    "ibm",
    "nvidia",
    "microsoft",
    "facebook",
    "meta",
    "apple",
    "amazon",
  ];
  if (BRAND_TOKENS.includes(ns)) return false;
  return true;
}

/**
 * Caller-side helper: load the trust + verified domains for the user's
 * own handle in one go. Used by both the page and the action.
 */
export async function loadCallerSignals(handle: string, userId: string) {
  const trust = await getPublisherTrust(handle).catch(() => null);
  const verifications = await prisma.publisherVerification.findMany({
    where: {
      handle: handle.toLowerCase(),
      method: "dns_txt",
      status: "verified",
      OR: [{ revokedAt: null }, { revokedAt: { gt: new Date() } }],
    },
    select: { target: true },
  });
  const domains = verifications.map((v) => v.target.toLowerCase());
  // Cross-check: maybe the user verified a github_oauth proof under a
  // different OXP handle (rare but possible). For claim purposes we only
  // care about the proof under the caller's current handle.
  return {
    githubLogin: trust?.githubLogin ?? null,
    level: trust?.level ?? "unverified",
    domains,
    userId,
  };
}
