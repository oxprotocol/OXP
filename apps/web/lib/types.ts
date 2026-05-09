// Schema-shaped types mirroring the Postgres plan in /memories/repo/architecture.md.
// In-memory mock today; same shapes will back the real DB tomorrow.

export type Plan = "free" | "pro" | "teams";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled";
export type OrgRole = "owner" | "admin" | "contributor" | "reader";
export type ExtensionVisibility = "public" | "private";
export type ExtensionStatus = "active" | "archived" | "dmca_holding";
/** Real-world availability. `planned` = announced/listed but not shippable yet. */
export type ExtensionAvailability = "available" | "planned";
export type AccountKind = "user" | "org";

/** Shared global namespace — every handle resolves to either a user OR an org. */
export interface NamespaceHandle {
  handle: string; // lowercase, unique across users + orgs
  kind: AccountKind;
  ownerId: string; // userId or orgId
  reserved?: boolean; // system-reserved (e.g. "oxp", "admin")
}

export interface User {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  avatarSeed: string; // for the initials chip
  /** Uploaded avatar URL; falls back to the initials chip when absent. */
  avatarUrl?: string;
  avatarUpdatedAt?: string;
  bio?: string;
  location?: string;
  website?: string;
  joinedAt: string;
  subscriptionId?: string;
  /** Phase B.8 — denormalized publisher trust tier. */
  verificationLevel?: "unverified" | "github" | "domain";
  verifiedAt?: string;
  githubLogin?: string;
}

export interface Organization {
  id: string;
  handle: string;
  displayName: string;
  description?: string;
  website?: string;
  verified: boolean;
  createdByUserId: string;
  joinedAt: string;
  subscriptionId?: string;
}

export interface Membership {
  orgId: string;
  userId: string;
  role: OrgRole;
}

export interface Subscription {
  id: string;
  plan: Plan;
  status: SubscriptionStatus;
  /** exactly one of these is set */
  subjectUserId?: string;
  subjectOrgId?: string;
  seats: number;
  currentPeriodEnd: string;
}

export interface Version {
  id: string;
  extensionId: string;
  semver: string;
  publishedAt: string;
  bundleSize: string; // "1.2 MB"
  signedByUserId: string;
  yankedAt?: string;
  changelog: string;
}

export interface Extension {
  id: string;
  ownerHandle: string; // denormalized for fast routing
  ownerKind: AccountKind;
  ownerId: string;
  slug: string;
  title: string;
  description: string;
  visibility: ExtensionVisibility;
  status: ExtensionStatus;
  tags: string[];
  repositoryUrl?: string;
  /** denormalized rollups */
  latestVersion: string;
  downloads: string;
  stars: number;
  /** content rendered as the readme */
  readme?: string;
}

/** Old flat id -> new scoped reference. Powers /packages/[id] redirects. */
export interface ExtensionAlias {
  alias: string; // legacy flat id, e.g. "gitlens-oxp"
  ownerHandle: string;
  slug: string;
}

/** Canonical id helpers — never parse strings ad-hoc. */
export function scopedId(ownerHandle: string, slug: string): string {
  return `@${ownerHandle}/${slug}`;
}

export function extensionPath(ownerHandle: string, slug: string): string {
  return `/${ownerHandle}/${slug}`;
}

export function profilePath(handle: string): string {
  return `/${handle}`;
}
