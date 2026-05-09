/**
 * Organization (team) lifecycle helpers.
 *
 *   createOrganization()  — claim a fresh handle, create the org row,
 *                           create the owner Membership and a NamespaceHandle
 *                           pointer in one transaction.
 *   listUserOrgs()        — every org the user is a member of, with role.
 *   listOrgMembers()      — full member list for the admin panel.
 *   listOrgInvites()      — outstanding (non-revoked, non-accepted, unexpired).
 *   createInvite()        — owner/admin sends an invitation by email.
 *   revokeInvite()        — owner/admin cancels a pending invite.
 *   redeemInvite()        — current user accepts an invite by raw token.
 *   removeMember()        — owner/admin kicks a member (cannot remove last owner).
 *   changeMemberRole()    — owner/admin promotes/demotes; same last-owner guard.
 *
 * Audit events are emitted from the API routes that wrap these helpers so
 * we always have request-scoped IP/UA.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { findReservedBrand } from "./reserved-handles";
import type { OrgRole } from "@prisma/client";

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface CreateOrgInput {
  handle: string;
  displayName: string;
  description?: string;
  website?: string;
}
export type CreateOrgResult =
  | { ok: true; orgId: string; handle: string }
  | { ok: false; status: number; error: string };

export async function createOrganization(
  ownerUserId: string,
  input: CreateOrgInput,
): Promise<CreateOrgResult> {
  const handle = input.handle.trim().toLowerCase().replace(/^@/, "");
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
  const displayName = input.displayName.trim().slice(0, 80);
  if (!displayName) {
    return { ok: false, status: 400, error: "displayName required" };
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
    const org = await prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({
        data: {
          handle,
          displayName,
          description: input.description?.trim() || null,
          website: input.website?.trim() || null,
          createdByUserId: ownerUserId,
        },
      });
      await tx.membership.create({
        data: { orgId: o.id, userId: ownerUserId, role: "owner" },
      });
      await tx.namespaceHandle.create({
        data: { handle, kind: "org", ownerId: o.id },
      });
      return o;
    });
    return { ok: true, orgId: org.id, handle: org.handle };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return { ok: false, status: 409, error: `@${handle} is already taken.` };
    }
    throw e;
  }
}

export interface UserOrg {
  id: string;
  handle: string;
  displayName: string;
  role: OrgRole;
  joinedAt: Date;
}

export async function listUserOrgs(userId: string): Promise<UserOrg[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: {
      org: {
        select: { id: true, handle: true, displayName: true, joinedAt: true },
      },
    },
    orderBy: { id: "asc" },
  });
  return rows.map((m) => ({
    id: m.org.id,
    handle: m.org.handle,
    displayName: m.org.displayName,
    role: m.role,
    joinedAt: m.org.joinedAt,
  }));
}

export interface OrgMember {
  userId: string;
  handle: string;
  displayName: string;
  email: string;
  role: OrgRole;
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const rows = await prisma.membership.findMany({
    where: { orgId },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, handle: true, displayName: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows
    .map((m) => {
      const u = byId.get(m.userId);
      if (!u) return null;
      return {
        userId: u.id,
        handle: u.handle,
        displayName: u.displayName,
        email: u.email,
        role: m.role,
      };
    })
    .filter((x): x is OrgMember => x !== null);
}

export interface PendingInvite {
  id: string;
  email: string;
  role: OrgRole;
  invitedById: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function listOrgInvites(orgId: string): Promise<PendingInvite[]> {
  const rows = await prisma.orgInvite.findMany({
    where: {
      orgId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    invitedById: r.invitedById,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface CreateInviteInput {
  orgId: string;
  email: string;
  role: OrgRole;
  invitedById: string;
}
export type CreateInviteResult =
  | { ok: true; inviteId: string; token: string; expiresAt: Date }
  | { ok: false; status: number; error: string };

const ALLOWED_INVITE_ROLES: OrgRole[] = ["admin", "contributor", "reader"];

export async function createInvite(
  input: CreateInviteInput,
): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: "invalid email" };
  }
  if (!ALLOWED_INVITE_ROLES.includes(input.role)) {
    return {
      ok: false,
      status: 400,
      error: "role must be admin/contributor/reader",
    };
  }

  // Already a member?
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    const m = await prisma.membership.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId: existingUser.id } },
    });
    if (m) {
      return { ok: false, status: 409, error: "user is already a member" };
    }
  }

  // Drop any prior pending invite for this email so a fresh token wins.
  await prisma.orgInvite.updateMany({
    where: {
      orgId: input.orgId,
      email,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const row = await prisma.orgInvite.create({
    data: {
      orgId: input.orgId,
      email,
      role: input.role,
      tokenHash: hashToken(raw),
      invitedById: input.invitedById,
      expiresAt,
    },
  });
  return { ok: true, inviteId: row.id, token: raw, expiresAt };
}

export async function revokeInvite(
  orgId: string,
  inviteId: string,
): Promise<boolean> {
  const r = await prisma.orgInvite.updateMany({
    where: { id: inviteId, orgId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count > 0;
}

export interface RedeemedInvite {
  orgId: string;
  orgHandle: string;
  role: OrgRole;
  inviteId: string;
  inviterId: string;
}
export type RedeemInviteResult =
  | { ok: true; data: RedeemedInvite }
  | { ok: false; status: number; error: string };

export async function redeemInvite(
  rawToken: string,
  userId: string,
): Promise<RedeemInviteResult> {
  if (!rawToken || rawToken.length < 16) {
    return { ok: false, status: 400, error: "invalid invite token" };
  }
  const hash = hashToken(rawToken);
  const row = await prisma.orgInvite.findUnique({ where: { tokenHash: hash } });
  if (!row) {
    return { ok: false, status: 404, error: "invite not found" };
  }
  if (row.revokedAt) {
    return { ok: false, status: 410, error: "invite was revoked" };
  }
  if (row.acceptedAt) {
    return { ok: false, status: 410, error: "invite already used" };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 410, error: "invite expired" };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) return { ok: false, status: 401, error: "not signed in" };
  if (user.email.toLowerCase() !== row.email.toLowerCase()) {
    return {
      ok: false,
      status: 403,
      error: `invite is for ${row.email}; sign in with that account to accept`,
    };
  }
  const org = await prisma.organization.findUnique({
    where: { id: row.orgId },
    select: { id: true, handle: true },
  });
  if (!org) return { ok: false, status: 404, error: "org no longer exists" };

  // Idempotent membership upsert; if they're somehow already a member just
  // mark the invite consumed.
  await prisma.$transaction([
    prisma.membership.upsert({
      where: { orgId_userId: { orgId: org.id, userId } },
      create: { orgId: org.id, userId, role: row.role },
      update: {}, // keep existing role; never auto-demote
    }),
    prisma.orgInvite.update({
      where: { id: row.id },
      data: { acceptedAt: new Date(), acceptedById: userId },
    }),
  ]);
  return {
    ok: true,
    data: {
      orgId: org.id,
      orgHandle: org.handle,
      role: row.role,
      inviteId: row.id,
      inviterId: row.invitedById,
    },
  };
}

/**
 * Refuse an action that would leave the org with zero owners. Internal helper.
 */
async function wouldOrphanOrg(
  orgId: string,
  userIdLeaving: string,
  newRoleForLeaver?: OrgRole,
): Promise<boolean> {
  const owners = await prisma.membership.findMany({
    where: { orgId, role: "owner" },
    select: { userId: true },
  });
  const ownerIds = new Set(owners.map((o) => o.userId));
  // Simulate the change.
  if (newRoleForLeaver && newRoleForLeaver !== "owner") {
    ownerIds.delete(userIdLeaving);
  } else if (!newRoleForLeaver) {
    ownerIds.delete(userIdLeaving);
  }
  return ownerIds.size === 0;
}

export type MutateMemberResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function removeMember(
  orgId: string,
  userId: string,
): Promise<MutateMemberResult> {
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!m) return { ok: false, status: 404, error: "not a member" };
  if (m.role === "owner") {
    if (await wouldOrphanOrg(orgId, userId)) {
      return {
        ok: false,
        status: 409,
        error: "cannot remove the last owner",
      };
    }
  }
  await prisma.membership.delete({
    where: { orgId_userId: { orgId, userId } },
  });
  return { ok: true };
}

export async function changeMemberRole(
  orgId: string,
  userId: string,
  newRole: OrgRole,
): Promise<MutateMemberResult> {
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!m) return { ok: false, status: 404, error: "not a member" };
  if (m.role === "owner" && newRole !== "owner") {
    if (await wouldOrphanOrg(orgId, userId, newRole)) {
      return {
        ok: false,
        status: 409,
        error: "cannot demote the last owner",
      };
    }
  }
  if (m.role === newRole) return { ok: true };
  await prisma.membership.update({
    where: { orgId_userId: { orgId, userId } },
    data: { role: newRole },
  });
  return { ok: true };
}
