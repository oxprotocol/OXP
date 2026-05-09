/**
 * POST /api/billing/webhook
 *
 * Receives Paddle Billing webhooks. The body MUST be read raw before any
 * parsing so the HMAC verification stays consistent with what Paddle
 * signed; Next's Request.text() gives us exactly that.
 *
 * Events we handle (everything else is acknowledged with 200 so Paddle
 * stops retrying):
 *
 *   subscription.created
 *   subscription.activated
 *   subscription.updated         — plan / status changes, scheduled cancels
 *   subscription.canceled        — terminal cancel; downgrade to free at period end
 *   subscription.past_due
 *   subscription.paused
 *   subscription.resumed
 *
 * The user is identified via `data.custom_data.userId`, which the
 * checkout endpoint embeds when creating the transaction. If that id
 * isn't present we fall back to matching `paddleCustomerId`.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  planForPaddlePriceId,
  PLANS,
  ensureFreeSubscription,
  type PlanId,
} from "@/lib/billing";
import {
  verifyWebhookSignature,
  type PaddleSubscriptionPayload,
  type PaddleWebhookEvent,
} from "@/lib/paddle";
import {
  sendEmail,
  subscriptionActivatedEmail,
  subscriptionCanceledEmail,
} from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const sig = req.headers.get("paddle-signature");
  const verdict = verifyWebhookSignature(raw, sig);
  if (!verdict.ok) {
    // 401 so Paddle retries. Log only the reason — never the body.
    console.warn("[billing/webhook] rejected:", verdict.reason);
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

  let event: PaddleWebhookEvent;
  try {
    event = JSON.parse(raw) as PaddleWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!event.event_type?.startsWith("subscription.")) {
    // Acknowledge non-subscription events (transaction.*, customer.*, …)
    // so Paddle doesn't retry. We don't currently need to act on them.
    return NextResponse.json({ ok: true, ignored: event.event_type });
  }

  const sub = event.data as PaddleSubscriptionPayload;
  const customDataUserId =
    typeof sub.custom_data?.userId === "string"
      ? (sub.custom_data.userId as string)
      : null;

  // Find the OXP user this subscription belongs to.
  let userId = customDataUserId;
  if (!userId && sub.customer_id) {
    const existing = await prisma.subscription.findFirst({
      where: { paddleCustomerId: sub.customer_id },
      select: { subjectUserId: true },
    });
    userId = existing?.subjectUserId ?? null;
  }
  if (!userId) {
    console.warn(
      "[billing/webhook] could not resolve OXP user for paddle sub",
      sub.id,
    );
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const priceId = sub.items?.[0]?.price?.id ?? null;
  const planId = planForPaddlePriceId(priceId);
  const periodEnd = sub.current_billing_period?.ends_at
    ? new Date(sub.current_billing_period.ends_at)
    : null;
  const cancelAt =
    sub.scheduled_change?.action === "cancel" &&
    sub.scheduled_change.effective_at
      ? new Date(sub.scheduled_change.effective_at)
      : null;

  // Map Paddle status → our enum. Anything we don't recognize falls back
  // to active (Paddle won't be sending us garbage; this is just defensive).
  const status =
    sub.status === "trialing"
      ? "trialing"
      : sub.status === "past_due"
        ? "past_due"
        : sub.status === "canceled"
          ? "canceled"
          : "active";

  await ensureFreeSubscription(userId);

  // For canceled events we keep the row on the paid plan until the
  // current billing period ends — Paddle will continue providing service
  // until then. The dashboard reads `cancelAt` to surface that state.
  const targetPlan =
    event.event_type === "subscription.canceled" &&
    periodEnd &&
    periodEnd > new Date()
      ? (planId ?? "free")
      : status === "canceled"
        ? "free"
        : (planId ?? "free");

  // Free rows use a far-future sentinel so range queries don't false-positive.
  const FAR_FUTURE = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const ONE_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const resolvedPeriodEnd =
    periodEnd ??
    (PLANS[targetPlan].priceCentsEur === 0 ? FAR_FUTURE : ONE_MONTH);

  await prisma.subscription.update({
    where: { subjectUserId: userId },
    data: {
      plan: targetPlan,
      status,
      paddleSubId: sub.id,
      paddleCustomerId: sub.customer_id,
      paddlePriceId: priceId,
      currentPeriodEnd: resolvedPeriodEnd,
      cancelAt,
    },
  });

  // Notify the user. Each event type maps to one email at most; we never
  // throw from here so a Postmark outage can't make Paddle retry the hook.
  void notifyByEmail(event.event_type, userId, targetPlan, sub, cancelAt);

  return NextResponse.json({ ok: true, plan: targetPlan, status });
}

async function notifyByEmail(
  eventType: string,
  userId: string,
  planId: string,
  sub: PaddleSubscriptionPayload,
  cancelAt: Date | null,
): Promise<void> {
  try {
    if (!(planId in PLANS)) return;
    const plan = PLANS[planId as PlanId];
    if (plan.priceCentsEur === 0) return; // never email about free plan

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, handle: true },
    });
    if (!user?.email) return;

    if (
      eventType === "subscription.activated" ||
      eventType === "subscription.created"
    ) {
      const amountDisplay = formatPaddleAmount(sub);
      await sendEmail({
        to: user.email,
        template: subscriptionActivatedEmail({
          handle: user.handle,
          planName: plan.name,
          amountDisplay,
        }),
        tag: "subscription-activated",
      });
    } else if (eventType === "subscription.canceled" && cancelAt) {
      await sendEmail({
        to: user.email,
        template: subscriptionCanceledEmail({
          handle: user.handle,
          planName: plan.name,
          endsAt: cancelAt,
        }),
        tag: "subscription-canceled",
      });
    }
  } catch (err) {
    console.error("[billing/webhook] email notify failed:", err);
  }
}

function formatPaddleAmount(sub: PaddleSubscriptionPayload): string {
  const item = sub.items?.[0];
  const amount = item?.price?.unit_price?.amount;
  const currency = item?.price?.unit_price?.currency_code ?? "EUR";
  if (!amount) return `${currency} —`;
  // Paddle returns minor units as a string (e.g. "900" = 9.00).
  const minor = Number(amount);
  if (!Number.isFinite(minor)) return `${currency} —`;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
  }).format(minor / 100);
}
