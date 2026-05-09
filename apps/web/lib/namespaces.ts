/**
 * Personal namespace aliases.
 *
 * A `User` always owns one canonical handle stored as `User.handle`. On top of
 * that they may claim additional handles ("aliases") up to their plan cap
 * (`PlanLimits.maxNamespaces`). Aliases are stored as `NamespaceHandle` rows
 * with `kind = "user"` and `ownerId = user.id`. They behave exactly like the
 * primary handle for publishing: `callerCanPublishAs` and the publisher
 * resolver in `lib/publish.ts` consult this table.
 *
 * Why a separate table instead of an array column on `User`?
 *   1. Global uniqueness — `NamespaceHandle.handle` is `@unique` across users,
 *      orgs, and reservations, so we get collision protection for free.
 *   2. Reuse — the table already exists for SSO-provisioned users and brand
 *      reservations, so one resolver handles all cases.
 *
 * The primary handle is NOT auto-mirrored into NamespaceHandle for legacy
 * accounts. Resolvers therefore check both tables.
 */

import { prisma } from "./prisma";
import { findReservedBrand } from "./reserved-handles";
import { getUserPlan, PLANS } from "./billing";

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export interface UserNamespace {
  handle: string;
  kind: "primary" | "alias";
  claimedAt: Date | null;
}

/** All namespaces owned by `userId` — primary first, aliases after. */
export async function listUserNamespaces(
  userId: string,
): Promise<UserNamespace[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true, joinedAt: true },
  });
  if (!user) return [];
  const aliases = await prisma.namespaceHandle.findMany({
    where: { ownerId: userId, kind: "user", handle: { not: user.handle } },
    select: { handle: true },
    orderBy: { handle: "asc" },
  });
  return [
    { handle: user.handle, kind: "primary", claimedAt: user.joinedAt },
    ...aliases.map((a) => ({
      handle: a.handle,
      kind: "alias" as const,
      claimedAt: null,
    })),
  ];
}

/** Total namespaces (primary + aliases) the user currently owns. */
export async function countUserNamespaces(userId: string): Promise<number> {
  const list = await listUserNamespaces(userId);
  return list.length;
}

export type ClaimResult =
  | { ok: true; handle: string }
  | { ok: false; status: number; error: string };

/**
 * Claim a new alias namespace for `userId`. Enforces:
 *   - syntactically valid handle (1–32 chars, lower alnum + dash, no leading
 *     dash, no double dash run from regex start);
 *   - handle not in the global reserved-brand list (would require manual KYC);
 *   - handle not already in `NamespaceHandle`, `User.handle`, or
 *     `Organization.handle`;
 *   - caller's plan permits another namespace.
 *
 * On success the row is `kind: "user", ownerId: userId, reserved: false`.
 */
export async function claimNamespace(
  userId: string,
  rawHandle: string,
): Promise<ClaimResult> {
  const handle = rawHandle.trim().toLowerCase().replace(/^@/, "");
  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      status: 400,
      error:
        "Handle must be 1–32 chars, lowercase letters/digits/dashes, and cannot start or end with a dash.",
    };
  }
  if (findReservedBrand(handle)) {
    return {
      ok: false,
      status: 409,
      error: `@${handle} is reserved for brand-protection. Contact support to claim it via KYC.`,
    };
  }

  const plan = await getUserPlan(userId);
  const cap = PLANS[plan.plan].limits.maxNamespaces;
  const current = await countUserNamespaces(userId);
  if (cap !== -1 && current >= cap) {
    return {
      ok: false,
      status: 402,
      error: `Plan ${plan.plan} allows ${cap} namespaces. You already own ${current}. Upgrade to Pro for unlimited handles.`,
    };
  }

  // Atomic uniqueness check across all three sources.
  const [nh, u, o] = await Promise.all([
    prisma.namespaceHandle.findUnique({ where: { handle } }),
    prisma.user.findUnique({ where: { handle }, select: { id: true } }),
    prisma.organization.findUnique({ where: { handle }, select: { id: true } }),
  ]);
  if (nh || u || o) {
    return { ok: false, status: 409, error: `@${handle} is already taken.` };
  }

  try {
    await prisma.namespaceHandle.create({
      data: { handle, kind: "user", ownerId: userId },
    });
  } catch (e) {
    // Race condition on the unique index — translate to a clean 409.
    if ((e as { code?: string }).code === "P2002") {
      return { ok: false, status: 409, error: `@${handle} is already taken.` };
    }
    throw e;
  }
  return { ok: true, handle };
}

/**
 * Release an alias. The user's primary handle (`User.handle`) cannot be
 * released here — that requires a separate rename flow which is out of scope.
 * Returns false if the row doesn't exist or isn't owned by the caller.
 */
export async function releaseNamespace(
  userId: string,
  rawHandle: string,
): Promise<boolean> {
  const handle = rawHandle.trim().toLowerCase().replace(/^@/, "");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true },
  });
  if (!user) return false;
  if (user.handle === handle) return false; // primary

  const row = await prisma.namespaceHandle.findUnique({ where: { handle } });
  if (!row || row.ownerId !== userId || row.kind !== "user") return false;

  // Refuse if any extension is published under this handle.
  const inUse = await prisma.extension.count({
    where: { ownerHandle: handle },
  });
  if (inUse > 0) return false;

  await prisma.namespaceHandle.delete({ where: { handle } });
  return true;
}

/** True if `handle` is owned by `userId` (either primary or claimed alias). */
export async function userOwnsHandle(
  userId: string,
  handle: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true },
  });
  if (user?.handle === handle) return true;
  const row = await prisma.namespaceHandle.findUnique({ where: { handle } });
  return !!row && row.kind === "user" && row.ownerId === userId;
}
