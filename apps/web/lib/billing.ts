/**
 * OXP billing — single source of truth for plans, prices, and quotas.
 *
 * The pricing page, the checkout API, and any feature-gating code all read
 * from this catalog. Add a new plan here and it lights up everywhere.
 *
 * Honesty policy: features marked `roadmap: true` are NOT enforced or
 * delivered yet. The pricing UI surfaces a "Soon" chip next to them and the
 * checkout flow makes no promise about their availability. Move them to
 * `roadmap: false` only when the feature actually ships behind the gate.
 */

import type { Plan } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PlanId = Plan; // "free" | "pro" | "teams" | "enterprise"

export interface PlanFeature {
  label: string;
  /** True if not yet enforced in code today. UI shows a "Soon" pill. */
  roadmap?: boolean;
}

export interface PlanLimits {
  /** -1 = unlimited. */
  publicExtensions: number;
  privateExtensions: number;
  privateMcpServers: number;
  /** Personal namespace handles a User may own. Counts the primary @handle
   *  plus any aliases claimed via /dashboard/namespaces. -1 = unlimited. */
  maxNamespaces: number;
  /** GB / month soft cap. -1 = unlimited. */
  cdnBandwidthGb: number;
  /** Days of audit log retention. 0 = none, -1 = unlimited. */
  auditLogRetentionDays: number;
  organizations: boolean;
  ssoSamlOidc: boolean;
  selfHost: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Monthly price in EUR cents. 0 = free, null = "Custom" / contact sales. */
  priceCentsEur: number | null;
  cadence: string;
  tagline: string;
  cta: string;
  ctaHref: string;
  highlight?: boolean;
  features: PlanFeature[];
  limits: PlanLimits;
  /** Paddle Billing price id (`pri_…`). Read from env at runtime. */
  paddlePriceId?: string | null;
}

const PADDLE_PRO = process.env.PADDLE_PRICE_PRO_MONTHLY ?? null;
const PADDLE_TEAMS = process.env.PADDLE_PRICE_TEAMS_MONTHLY ?? null;

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    priceCentsEur: 0,
    cadence: "forever",
    tagline:
      "For developers publishing public OXP extensions and exploring the MCP library.",
    cta: "Start free",
    ctaHref: "/signup",
    features: [
      { label: "Unlimited public OXP extensions" },
      { label: "3 personal namespaces (@you, @side-project, …)" },
      { label: "10 GB CDN bandwidth / month" },
      { label: "Full WASM runtime + CLI on every host" },
      { label: "VS Code, JetBrains, Neovim & Piye adapters" },
      { label: "Browse + install all 2,500+ MCP servers" },
      { label: "VSX mirror access" },
      { label: "TOTP 2FA on your account" },
      { label: "Community support" },
    ],
    limits: {
      publicExtensions: -1,
      privateExtensions: 0,
      privateMcpServers: 0,
      maxNamespaces: 3,
      cdnBandwidthGb: 10,
      auditLogRetentionDays: 0,
      organizations: false,
      ssoSamlOidc: false,
      selfHost: false,
    },
    paddlePriceId: null,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCentsEur: 900,
    cadence: "per user / month",
    tagline:
      "For solo developers shipping private extensions or monetizing publicly.",
    cta: "Upgrade to Pro",
    ctaHref: "/api/billing/checkout?plan=pro",
    highlight: true,
    features: [
      { label: "Everything in Free" },
      { label: "Unlimited private extensions" },
      { label: "Install + download analytics" },
      { label: "Sigstore-signed releases" },
      { label: "100 GB CDN bandwidth / month" },
      { label: "Email support" },
    ],
    limits: {
      publicExtensions: -1,
      privateExtensions: -1,
      privateMcpServers: 5,
      maxNamespaces: -1,
      cdnBandwidthGb: 100,
      auditLogRetentionDays: 30,
      organizations: false,
      ssoSamlOidc: false,
      selfHost: false,
    },
    paddlePriceId: PADDLE_PRO,
  },
  teams: {
    id: "teams",
    name: "Teams",
    priceCentsEur: 2400,
    cadence: "per user / month",
    tagline:
      "For organizations distributing internal extensions and MCP servers across the company.",
    cta: "Start a Teams trial",
    ctaHref: "/api/billing/checkout?plan=teams",
    features: [
      { label: "Everything in Pro" },
      { label: "Organizations + role-based access" },
      { label: "GitHub + DNS publisher verification" },
      { label: "Audit logs" },
      { label: "1 TB CDN bandwidth / month" },
      { label: "SAML / OIDC single sign-on" },
      { label: "Custom domain (oxp.your-co.com)" },
      { label: "Email support" },
    ],
    limits: {
      publicExtensions: -1,
      privateExtensions: -1,
      privateMcpServers: -1,
      maxNamespaces: -1,
      cdnBandwidthGb: 1000,
      auditLogRetentionDays: 365,
      organizations: true,
      ssoSamlOidc: true,
      selfHost: false,
    },
    paddlePriceId: PADDLE_TEAMS,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceCentsEur: null,
    cadence: "annual contract",
    tagline:
      "For regulated companies that need self-hosting, compliance, and a contractual SLA.",
    cta: "Talk to sales",
    ctaHref: "mailto:sales@oxp.sh?subject=OXP%20Enterprise",
    features: [
      { label: "Everything in Teams" },
      { label: "Self-hosted registry + runtime (on-prem or VPC)" },
      { label: "Air-gapped install bundles" },
      { label: "Named solutions engineer + onboarding" },
      { label: "Unlimited bandwidth + seats" },
      { label: "Bring your own object storage (S3 / R2 / MinIO)" },
      { label: "Sigstore + customer-managed KMS signing (AWS KMS)" },
      { label: "GDPR DPA + custom MSA on request" },
      { label: "99.95 % uptime SLA (contractual)" },
    ],
    limits: {
      publicExtensions: -1,
      privateExtensions: -1,
      privateMcpServers: -1,
      maxNamespaces: -1,
      cdnBandwidthGb: -1,
      auditLogRetentionDays: -1,
      organizations: true,
      ssoSamlOidc: true,
      selfHost: true,
    },
    paddlePriceId: null,
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "teams"];

/** All plan ids including hidden ones. Used for billing/webhook lookups. */
export const ALL_PLAN_IDS: PlanId[] = ["free", "pro", "teams", "enterprise"];

/** Format a EUR cent integer as a localized price string. */
export function formatPrice(cents: number | null): string {
  if (cents === null) return "Custom";
  if (cents === 0) return "€0";
  return `€${(cents / 100).toFixed(0)}`;
}

/**
 * Idempotent: ensure every authenticated user has a Subscription row. Called
 * from signup actions and defensively on plan lookup. Org subscriptions are
 * created lazily when the org owner upgrades.
 */
export async function ensureFreeSubscription(userId: string): Promise<void> {
  const existing = await prisma.subscription.findUnique({
    where: { subjectUserId: userId },
    select: { id: true },
  });
  if (existing) return;
  // Sentinel period end ~100 years out so range queries against paid plans
  // never accidentally treat a free user as expired.
  const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  await prisma.subscription.create({
    data: {
      plan: "free",
      status: "active",
      subjectUserId: userId,
      seats: 1,
      currentPeriodEnd: farFuture,
    },
  });
}

export interface ResolvedPlan {
  plan: PlanId;
  status: "active" | "trialing" | "past_due" | "canceled";
  currentPeriodEnd: Date;
  cancelAt: Date | null;
  seats: number;
  paddleSubId: string | null;
}

/**
 * Resolve the active plan for a user. Falls back to creating + returning a
 * `free` subscription if the user does not have one yet (e.g. older accounts
 * that predate billing).
 */
export async function getUserPlan(userId: string): Promise<ResolvedPlan> {
  let row = await prisma.subscription.findUnique({
    where: { subjectUserId: userId },
  });
  if (!row) {
    await ensureFreeSubscription(userId);
    row = await prisma.subscription.findUnique({
      where: { subjectUserId: userId },
    });
  }
  if (!row) {
    // Defensive: this branch is unreachable in practice but keeps the type
    // narrow without a non-null assertion.
    throw new Error("Failed to materialize subscription for user " + userId);
  }
  return {
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAt: row.cancelAt,
    seats: row.seats,
    paddleSubId: row.paddleSubId,
  };
}

/**
 * Resolve the active plan for any subject (User or Organization).
 * Mirrors `getUserPlan` for users; for orgs reads the org subscription
 * directly (no auto-create — orgs that haven't subscribed are `free`).
 */
export async function getSubjectPlan(
  subjectKind: "user" | "org",
  subjectId: string,
): Promise<PlanId> {
  if (subjectKind === "user") {
    return (await getUserPlan(subjectId)).plan;
  }
  const row = await prisma.subscription.findUnique({
    where: { subjectOrgId: subjectId },
    select: { plan: true },
  });
  return row?.plan ?? "free";
}

/** Resolve a paddle priceId back to the plan id we sell it as. */
export function planForPaddlePriceId(priceId: string | null): PlanId | null {
  if (!priceId) return null;
  for (const id of ALL_PLAN_IDS) {
    if (PLANS[id].paddlePriceId === priceId) return id;
  }
  return null;
}
