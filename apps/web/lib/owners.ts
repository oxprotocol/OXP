import type {
  User,
  Organization,
  Membership,
  Subscription,
  NamespaceHandle,
} from "./types";

// ─── Reserved system handles (router-level guard) ────────────────────────────
// These MUST also exist as static routes; the App Router resolves static
// segments before dynamic /[handle], so they're safe today.
export const RESERVED_HANDLES = new Set<string>([
  "oxp",
  "admin",
  "api",
  "www",
  "docs",
  "packages",
  "community",
  "signin",
  "signout",
  "launch",
  "publish",
  "pricing",
  "settings",
  "help",
  "status",
  "blog",
  "legal",
  "terms",
  "privacy",
  "about",
  "dashboard",
  "new",
  "mcp",
  "_next",
  "static",
]);

// ─── Mock subscriptions ───────────────────────────────────────────────────────
export const subscriptions: Subscription[] = [
  {
    id: "sub_oxp_core",
    plan: "teams",
    status: "active",
    subjectOrgId: "org_oxp_core",
    seats: 12,
    currentPeriodEnd: "2026-12-31",
  },
  {
    id: "sub_anthropic",
    plan: "teams",
    status: "active",
    subjectOrgId: "org_anthropic",
    seats: 40,
    currentPeriodEnd: "2026-12-31",
  },
  {
    id: "sub_tailwindlabs",
    plan: "teams",
    status: "active",
    subjectOrgId: "org_tailwindlabs",
    seats: 8,
    currentPeriodEnd: "2026-12-31",
  },
  {
    id: "sub_meta_oss",
    plan: "teams",
    status: "active",
    subjectOrgId: "org_meta_oss",
    seats: 25,
    currentPeriodEnd: "2026-12-31",
  },
  {
    id: "sub_oxp_themes",
    plan: "teams",
    status: "active",
    subjectOrgId: "org_oxp_themes",
    seats: 4,
    currentPeriodEnd: "2026-12-31",
  },
  {
    id: "sub_eamodio",
    plan: "pro",
    status: "active",
    subjectUserId: "usr_eamodio",
    seats: 1,
    currentPeriodEnd: "2026-12-31",
  },
  {
    id: "sub_sayed",
    plan: "pro",
    status: "active",
    subjectUserId: "usr_sayedmibra",
    seats: 1,
    currentPeriodEnd: "2026-12-31",
  },
];

// ─── Mock users ───────────────────────────────────────────────────────────────
export const users: User[] = [
  {
    id: "usr_eamodio",
    handle: "eamodio",
    displayName: "Eric Amodio",
    email: "eric@example.com",
    avatarSeed: "EA",
    bio: "Creator of GitLens. Building the most-loved Git tooling for IDEs.",
    location: "Boston, MA",
    website: "https://eamodio.dev",
    joinedAt: "2024-02-11",
    subscriptionId: "sub_eamodio",
  },
  {
    id: "usr_sayedmibra",
    handle: "sayedmibra",
    displayName: "Sayed M. Ibrahim",
    email: "sayed@piye.studio",
    avatarSeed: "SI",
    bio: "Founder of Piye Studios. Architect of the Open eXtensions Protocol.",
    location: "Berlin / Cairo",
    website: "https://piye.studio",
    joinedAt: "2024-01-04",
    subscriptionId: "sub_sayed",
  },
  {
    id: "usr_kuroh",
    handle: "kuroh",
    displayName: "Kuroh",
    email: "k@kuroh.dev",
    avatarSeed: "KU",
    bio: "Modal editing enjoyer. NeoVim Bridge maintainer.",
    joinedAt: "2024-08-19",
  },
];

// ─── Mock organizations ───────────────────────────────────────────────────────
export const organizations: Organization[] = [
  {
    id: "org_oxp_core",
    handle: "oxp-core",
    displayName: "OXP Core",
    description:
      "The protocol team. We maintain the runtime, the CLI, and the official extensions.",
    website: "https://oxp.sh",
    verified: true,
    createdByUserId: "usr_sayedmibra",
    joinedAt: "2024-01-04",
    subscriptionId: "sub_oxp_core",
  },
  {
    id: "org_anthropic",
    handle: "anthropic",
    displayName: "Anthropic",
    description: "AI safety company. Makers of Claude.",
    website: "https://anthropic.com",
    verified: true,
    createdByUserId: "usr_sayedmibra",
    joinedAt: "2024-03-22",
    subscriptionId: "sub_anthropic",
  },
  {
    id: "org_tailwindlabs",
    handle: "tailwindlabs",
    displayName: "Tailwind Labs",
    description: "The team behind Tailwind CSS.",
    website: "https://tailwindcss.com",
    verified: true,
    createdByUserId: "usr_sayedmibra",
    joinedAt: "2024-04-10",
    subscriptionId: "sub_tailwindlabs",
  },
  {
    id: "org_meta_oss",
    handle: "meta-oss",
    displayName: "Meta Open Source",
    description: "React, Jest, and friends.",
    website: "https://opensource.fb.com",
    verified: true,
    createdByUserId: "usr_sayedmibra",
    joinedAt: "2024-05-01",
    subscriptionId: "sub_meta_oss",
  },
  {
    id: "org_oxp_themes",
    handle: "oxp-themes",
    displayName: "OXP Themes Collective",
    description: "Community-curated themes for the OXP runtime.",
    verified: false,
    createdByUserId: "usr_sayedmibra",
    joinedAt: "2024-06-15",
    subscriptionId: "sub_oxp_themes",
  },
  {
    id: "org_piye",
    handle: "piye-studios",
    displayName: "Piye Studios",
    description: "Premium developer tools and IDE extensions.",
    website: "https://piye.studio",
    verified: true,
    createdByUserId: "usr_sayedmibra",
    joinedAt: "2024-01-04",
  },
];

// ─── Memberships ──────────────────────────────────────────────────────────────
export const memberships: Membership[] = [
  { orgId: "org_oxp_core", userId: "usr_sayedmibra", role: "owner" },
  { orgId: "org_oxp_core", userId: "usr_kuroh", role: "contributor" },
  { orgId: "org_anthropic", userId: "usr_sayedmibra", role: "admin" },
  { orgId: "org_piye", userId: "usr_sayedmibra", role: "owner" },
  { orgId: "org_oxp_themes", userId: "usr_kuroh", role: "contributor" },
];

// ─── Namespace table — single source of truth for handle lookups ─────────────
export const namespaceHandles: NamespaceHandle[] = [
  ...users.map<NamespaceHandle>((u) => ({
    handle: u.handle,
    kind: "user",
    ownerId: u.id,
  })),
  ...organizations.map<NamespaceHandle>((o) => ({
    handle: o.handle,
    kind: "org",
    ownerId: o.id,
  })),
  ...Array.from(RESERVED_HANDLES).map<NamespaceHandle>((h) => ({
    handle: h,
    kind: "user", // placeholder
    ownerId: "system",
    reserved: true,
  })),
];
