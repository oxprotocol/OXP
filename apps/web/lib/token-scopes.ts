/**
 * Phase A.8 — server-side token scope helpers.
 *
 * The pure scope grammar lives in `@oxprotocol/types` so the registry, the
 * CLI, and tests share one parser. This file re-exports those helpers
 * and adds the registry-only constants that have no business in a
 * leaf type package.
 */

export {
  canPublish,
  canRotateOthers,
  isValidScope,
  parsePackageId,
} from "@oxprotocol/types";

/**
 * Default expiry for newly-minted publish tokens — 90 days. Long
 * enough that a developer doesn't need to rotate every sprint, short
 * enough that a leaked token rolls off without intervention.
 */
export const DEFAULT_TOKEN_TTL_DAYS = 90;

/**
 * After a successful rotation, the OLD token gets this much grace so
 * a publish in flight (large bundle, slow link) doesn't break. 5 min
 * is generous for a single upload and short enough that a leaked
 * token is mostly useless.
 */
export const ROTATION_GRACE_MS = 5 * 60 * 1000;
