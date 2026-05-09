/**
 * Phase A.8 — publish token scope grammar.
 *
 * Pure functions only — no Node imports — so it lives in @oxprotocol/types
 * and can be reused by the registry server, the CLI, and tests
 * without dragging in Prisma/Next.
 *
 * Scope strings stored on `ApiToken.scopes`:
 *
 *   - `*`                     — root, grants everything (admin only)
 *   - `publish:*`             — publish ANY package
 *   - `publish:@h/*`          — publish anything under @h
 *   - `publish:@h/slug`       — publish exactly one package
 *   - `tokens:rotate`         — admin: rotate someone else's token
 *                               (a token can ALWAYS rotate itself)
 *   - `publish` (bare)        — legacy alias for `publish:*`, kept
 *                               so pre-A.8 tokens keep working until
 *                               the next major
 */

const PACKAGE_ID = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;
const HANDLE = /^[a-z0-9][a-z0-9-]*$/;

export interface PackageId {
  publisher: string;
  slug: string;
}

export function parsePackageId(id: string): PackageId | null {
  const m = PACKAGE_ID.exec(id);
  if (!m) return null;
  return { publisher: m[1]!, slug: m[2]! };
}

/**
 * Decide whether the supplied scope set permits publishing
 * `@publisher/slug`. Order is permissive-first because a single
 * matching scope is enough; we never combine scopes.
 */
export function canPublish(
  scopes: readonly string[],
  packageId: string,
): boolean {
  const pkg = parsePackageId(packageId);
  if (!pkg) return false;
  for (const raw of scopes) {
    const s = raw.trim();
    if (s === "*") return true;
    if (s === "publish" || s === "publish:*") return true;
    if (!s.startsWith("publish:@")) continue;
    const target = s.slice("publish:".length);
    if (target.endsWith("/*")) {
      const handle = target.slice(1, -2);
      if (handle === pkg.publisher) return true;
    } else {
      const exact = parsePackageId(target);
      if (
        exact &&
        exact.publisher === pkg.publisher &&
        exact.slug === pkg.slug
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Holds permission to rotate ANY token owned by the same user. */
export function canRotateOthers(scopes: readonly string[]): boolean {
  return scopes.includes("*") || scopes.includes("tokens:rotate");
}

/**
 * Validate a scope string is well-formed BEFORE persisting. Mint and
 * narrow-on-rotate paths must run this — otherwise we'd accept e.g.
 * `publish:foo` (no `@`) and silently never match.
 */
export function isValidScope(s: string): boolean {
  if (
    s === "*" ||
    s === "publish" ||
    s === "publish:*" ||
    s === "tokens:rotate" ||
    s === "publisher:verify"
  )
    return true;
  if (!s.startsWith("publish:@")) return false;
  const target = s.slice("publish:".length);
  if (target.endsWith("/*")) return HANDLE.test(target.slice(1, -2));
  return parsePackageId(target) !== null;
}
