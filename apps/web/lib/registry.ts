// The single data-access layer. Pages MUST go through `registry.*` —
// never reach into owners.ts / extensions.ts directly. When we swap the
// in-memory mocks for Postgres, only this file changes.

import {
  namespaceHandles,
  organizations,
  users,
  memberships,
  subscriptions,
  RESERVED_HANDLES,
} from "./owners";
import { extensions, versions, extensionAliases } from "./extensions";
import type {
  Extension,
  ExtensionAlias,
  Membership,
  NamespaceHandle,
  Organization,
  Subscription,
  User,
  Version,
} from "./types";

// ─── Namespace resolution ────────────────────────────────────────────────────
export type ResolvedHandle =
  | { kind: "user"; user: User }
  | { kind: "org"; org: Organization }
  | { kind: "reserved" }
  | { kind: "missing" };

export function resolveHandle(handle: string): ResolvedHandle {
  const lower = handle.toLowerCase();
  if (RESERVED_HANDLES.has(lower)) return { kind: "reserved" };
  const ns = namespaceHandles.find((n) => n.handle === lower && !n.reserved);
  if (!ns) return { kind: "missing" };
  if (ns.kind === "user") {
    const user = users.find((u) => u.id === ns.ownerId);
    return user ? { kind: "user", user } : { kind: "missing" };
  }
  const org = organizations.find((o) => o.id === ns.ownerId);
  return org ? { kind: "org", org } : { kind: "missing" };
}

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle.toLowerCase());
}

// ─── Extension lookups ───────────────────────────────────────────────────────
export function getExtension(
  ownerHandle: string,
  slug: string,
): Extension | undefined {
  return extensions.find(
    (e) => e.ownerHandle === ownerHandle && e.slug === slug,
  );
}

export function getExtensionsByOwner(ownerHandle: string): Extension[] {
  return extensions.filter((e) => e.ownerHandle === ownerHandle);
}

export function listPublicExtensions(): Extension[] {
  return extensions.filter((e) => e.visibility === "public");
}

export function resolveAlias(legacyId: string): ExtensionAlias | undefined {
  return extensionAliases.find((a) => a.alias === legacyId);
}

// ─── Versions ────────────────────────────────────────────────────────────────
export function getVersionsForExtension(extensionId: string): Version[] {
  return versions
    .filter((v) => v.extensionId === extensionId)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function getLatestVersion(extensionId: string): Version | undefined {
  return getVersionsForExtension(extensionId)[0];
}

// ─── Memberships / orgs ──────────────────────────────────────────────────────
export function getMembersOfOrg(orgId: string): Array<{
  user: User;
  role: Membership["role"];
}> {
  return memberships
    .filter((m) => m.orgId === orgId)
    .map((m) => ({
      user: users.find((u) => u.id === m.userId)!,
      role: m.role,
    }))
    .filter((m) => m.user);
}

export function getOrgsForUser(userId: string): Organization[] {
  const orgIds = memberships
    .filter((m) => m.userId === userId)
    .map((m) => m.orgId);
  return organizations.filter((o) => orgIds.includes(o.id));
}

// ─── Billing / tier ──────────────────────────────────────────────────────────
export function getSubscriptionFor(
  subject: { kind: "user"; user: User } | { kind: "org"; org: Organization },
): Subscription | undefined {
  const id =
    subject.kind === "user"
      ? subject.user.subscriptionId
      : subject.org.subscriptionId;
  if (!id) return undefined;
  return subscriptions.find((s) => s.id === id);
}

// ─── Search ──────────────────────────────────────────────────────────────────
/** Public-only search — private extensions never leak into the directory. */
export function searchPublicExtensions(query: string): Extension[] {
  const q = query.toLowerCase().trim();
  const list = listPublicExtensions();
  if (!q) return list;
  return list.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.slug.toLowerCase().includes(q) ||
      e.ownerHandle.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

// Re-export the raw arrays for components that need to iterate everything
// (e.g. generateStaticParams). Reads only.
export {
  namespaceHandles,
  organizations,
  users,
  memberships,
  subscriptions,
  extensions,
  versions,
  extensionAliases,
};
export type { NamespaceHandle };
