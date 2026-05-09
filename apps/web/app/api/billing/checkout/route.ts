/**
 * POST /api/billing/checkout?plan=pro|teams
 *
 * Creates a Paddle Billing transaction for the signed-in user and either
 * (a) returns `{ transactionId, checkoutUrl }` for the client to open the
 *     Paddle.js overlay, or
 * (b) 302-redirects to Paddle's hosted checkout when called as a plain
 *     <form>/<a>.
 *
 * Free / Enterprise are not purchasable here:
 *   - free  → 400 (already the default; nothing to charge)
 *   - enterprise → 400 with a `mailto:sales@oxp.sh` hint
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PLANS, type PlanId } from "@/lib/billing";
import { createCheckoutTransaction, isPaddleConfigured } from "@/lib/paddle";

const PURCHASABLE: PlanId[] = ["pro", "teams"];

function appBaseUrl(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin.replace(/\/$/, "")
  );
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const planParam = (url.searchParams.get("plan") ?? "") as PlanId;
  const wantsJson =
    req.headers.get("accept")?.includes("application/json") ||
    req.method === "POST";

  if (!PURCHASABLE.includes(planParam)) {
    return NextResponse.json(
      {
        error: `plan must be one of: ${PURCHASABLE.join(", ")}`,
        hint:
          planParam === "enterprise"
            ? "Email sales@oxp.sh for Enterprise pricing."
            : undefined,
      },
      { status: 400 },
    );
  }
  const plan = PLANS[planParam];
  if (!plan.paddlePriceId) {
    return NextResponse.json(
      {
        error: `Paddle price id for ${planParam} is not configured`,
        hint: `Set PADDLE_PRICE_${planParam.toUpperCase()}_MONTHLY in the environment.`,
      },
      { status: 503 },
    );
  }
  if (!plan.paddlePriceId.startsWith("pri_")) {
    return NextResponse.json(
      {
        error: `PADDLE_PRICE_${planParam.toUpperCase()}_MONTHLY must be a Paddle price id ("pri_…"), got "${plan.paddlePriceId.slice(0, 8)}…"`,
        hint: "In Paddle, open the Product, then click into one of its Prices to copy the `pri_…` id (NOT the `pro_…` product id at the top of the product page).",
      },
      { status: 503 },
    );
  }
  if (!isPaddleConfigured()) {
    return NextResponse.json(
      {
        error: "Billing is not configured",
        hint: "PADDLE_API_KEY is missing on the server.",
      },
      { status: 503 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    // Bounce anonymous visitors to sign-in, preserving the upgrade intent.
    const next = `/api/billing/checkout?plan=${planParam}`;
    return NextResponse.redirect(
      `${appBaseUrl(req)}/signin?next=${encodeURIComponent(next)}`,
      303,
    );
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }

  let tx;
  try {
    tx = await createCheckoutTransaction({
      priceId: plan.paddlePriceId,
      userId: user.id,
      email: user.email,
      successUrl: `${appBaseUrl(req)}/dashboard?upgraded=${planParam}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/checkout] paddle error", message);
    return NextResponse.json(
      {
        error: "Could not start checkout — Paddle rejected the request.",
        detail: message,
      },
      { status: 502 },
    );
  }

  if (wantsJson) {
    return NextResponse.json(tx);
  }
  if (tx.checkoutUrl) {
    return NextResponse.redirect(tx.checkoutUrl, 303);
  }
  return NextResponse.json(tx);
}

export const GET = handle;
export const POST = handle;
