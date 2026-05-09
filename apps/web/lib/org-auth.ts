/**
 * Org-scoped authorization helpers.
 *
 * Every Teams/Enterprise admin action (custom domain, SSO, BYO storage,
 * KMS) must run through `requireOrgAdmin(handle)`. It:
 *   1. resolves the current user (or 401)
 *   2. resolves the org by handle (or 404)
 *   3. confirms the user has `owner` or `admin` role on that org (or 403)
 *   4. confirms the org's plan permits the requested capability
 */

import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getCurrentUser } from "./auth";
import { getUserPlan } from "./billing";
import type { User } from "./types";
import type { Organization, Membership, OrgRole } from "@prisma/client";

export class OrgAuthError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

export interface OrgContext {
  user: User;
  org: Organization;
  membership: Membership;
  plan: "free" | "pro" | "teams" | "enterprise";
}

export async function loadOrgContext(handle: string): Promise<OrgContext> {
  const user = await getCurrentUser();
  if (!user) throw new OrgAuthError(401, "not signed in");
  const org = await prisma.organization.findUnique({
    where: { handle: handle.toLowerCase() },
  });
  if (!org) throw new OrgAuthError(404, `unknown org @${handle}`);
  const membership = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
  });
  if (!membership) throw new OrgAuthError(403, "not a member of this org");
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new OrgAuthError(
      403,
      `role ${membership.role} cannot administer org`,
    );
  }
  // Plan resolution: we attribute the org's plan to its admins for gating.
  // (Per-org subscription rows live on Organization.subscriptionId.)
  const sub = org.subscriptionId
    ? await prisma.subscription.findUnique({
        where: { id: org.subscriptionId },
      })
    : null;
  const plan = sub?.plan ?? (await getUserPlan(user.id)).plan;
  return { user, org, membership, plan };
}

const TEAMS_PLUS = new Set(["teams", "enterprise"]);
const ENTERPRISE = new Set(["enterprise"]);

export function requireTeamsPlus(ctx: OrgContext): void {
  if (!TEAMS_PLUS.has(ctx.plan)) {
    throw new OrgAuthError(402, "Teams plan required");
  }
}

export function requireEnterprise(ctx: OrgContext): void {
  if (!ENTERPRISE.has(ctx.plan)) {
    throw new OrgAuthError(402, "Enterprise plan required");
  }
}

/** Server-component helper: redirect to /signin or /403 instead of throwing. */
export async function loadOrgContextOrRedirect(
  handle: string,
): Promise<OrgContext> {
  try {
    return await loadOrgContext(handle);
  } catch (e) {
    const err = e as OrgAuthError;
    if (err.status === 401) redirect(`/signin?next=/org/${handle}/admin`);
    redirect(`/`);
  }
}

/**
 * Read-only org loader: any member role (owner/admin/contributor/reader)
 * passes. Used by member-list views, dashboards, etc. Admin write paths
 * must still use `loadOrgContext`.
 */
export async function loadOrgMemberContext(
  handle: string,
): Promise<OrgContext> {
  const user = await getCurrentUser();
  if (!user) throw new OrgAuthError(401, "not signed in");
  const org = await prisma.organization.findUnique({
    where: { handle: handle.toLowerCase() },
  });
  if (!org) throw new OrgAuthError(404, `unknown org @${handle}`);
  const membership = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
  });
  if (!membership) throw new OrgAuthError(403, "not a member of this org");
  const sub = org.subscriptionId
    ? await prisma.subscription.findUnique({
        where: { id: org.subscriptionId },
      })
    : null;
  const plan = sub?.plan ?? (await getUserPlan(user.id)).plan;
  return { user, org, membership, plan };
}

export type { OrgRole };
