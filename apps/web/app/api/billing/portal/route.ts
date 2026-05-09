/**
 * GET /api/billing/portal
 *
 * Returns Paddle-hosted management URLs for the signed-in user's
 * subscription:
 *   { cancel: string | null, update_payment_method: string | null }
 *
 * GET /api/billing/portal?action=cancel|update_payment_method
 *   → 303 redirect to the corresponding Paddle URL.
 *
 * Free users get a 400; users without a paddleSubId get a 409 with a hint
 * to re-checkout (typically means the webhook hasn't landed yet).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserPlan } from "@/lib/billing";
import {
  getSubscriptionManagementUrls,
  isPaddleConfigured,
} from "@/lib/paddle";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isPaddleConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured" },
      { status: 503 },
    );
  }
  const plan = await getUserPlan(session.user.id);
  if (plan.plan === "free") {
    return NextResponse.json(
      { error: "no paid subscription to manage" },
      { status: 400 },
    );
  }
  if (!plan.paddleSubId) {
    return NextResponse.json(
      {
        error: "subscription not yet linked to Paddle",
        hint: "The webhook hasn't landed yet — try again in a minute.",
      },
      { status: 409 },
    );
  }

  let urls;
  try {
    urls = await getSubscriptionManagementUrls(plan.paddleSubId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "paddle error" },
      { status: 502 },
    );
  }

  const action = new URL(req.url).searchParams.get("action");
  if (action === "cancel" && urls.cancel) {
    return NextResponse.redirect(urls.cancel, 303);
  }
  if (action === "update_payment_method" && urls.update_payment_method) {
    return NextResponse.redirect(urls.update_payment_method, 303);
  }
  return NextResponse.json(urls);
}
