/**
 * Paddle Billing — minimal server-side helpers.
 *
 * We talk to Paddle over plain `fetch` against the Billing API
 * (https://api.paddle.com — sandbox: https://sandbox-api.paddle.com).
 * No SDK dependency: the surface we need (transactions.create, customers,
 * subscriptions.{get,update,cancel}, webhook signature verification) is
 * tiny enough that an SDK would weigh more than the code it replaces.
 *
 * Webhook signature verification follows Paddle's documented scheme:
 *   header: `Paddle-Signature: ts=<unix>;h1=<hex hmac-sha256>`
 *   payload: `${ts}:${rawBody}` signed with the notification secret.
 *   See https://developer.paddle.com/webhooks/signature-verification
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PADDLE_API_KEY = process.env.PADDLE_API_KEY ?? "";
const PADDLE_ENV = (process.env.PADDLE_ENV ?? "sandbox").toLowerCase();
const PADDLE_API_BASE =
  PADDLE_ENV === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET ?? "";

export function isPaddleConfigured(): boolean {
  return PADDLE_API_KEY.length > 0;
}

/**
 * Diagnose common Paddle configuration mistakes.
 *
 * Paddle API key formats:
 *   - Production: `pdl_live_apikey_*`
 *   - Sandbox:    `pdl_sdbx_apikey_*`
 *
 * A 403 from `transactions.create` with a valid key usually means the
 * seller's domain hasn't been approved yet (Checkout → Website Approval).
 */
export function diagnosePaddleKey(): string | null {
  if (!PADDLE_API_KEY) return "PADDLE_API_KEY is not set.";

  const isLiveKey = PADDLE_API_KEY.startsWith("pdl_live_");
  const isSandboxKey = PADDLE_API_KEY.startsWith("pdl_sdbx_");

  if (!isLiveKey && !isSandboxKey) {
    return (
      `PADDLE_API_KEY has an unrecognized prefix. Expected "pdl_live_apikey_*" ` +
      `(production) or "pdl_sdbx_apikey_*" (sandbox). Go to Paddle → ` +
      `Developer Tools → Authentication to copy the correct key.`
    );
  }
  if (PADDLE_ENV === "production" && isSandboxKey) {
    return (
      `PADDLE_ENV=production but PADDLE_API_KEY is a sandbox key (pdl_sdbx_*). ` +
      `Use a "pdl_live_*" key for production, or set PADDLE_ENV=sandbox.`
    );
  }
  if (PADDLE_ENV === "sandbox" && isLiveKey) {
    return (
      `PADDLE_ENV=sandbox but PADDLE_API_KEY is a production key (pdl_live_*). ` +
      `Use a "pdl_sdbx_*" key for sandbox, or set PADDLE_ENV=production.`
    );
  }
  // Key format looks fine — 403 is likely a domain-approval or permissions issue.
  return null;
}

export function paddleEnvironment(): "production" | "sandbox" {
  return PADDLE_ENV === "production" ? "production" : "sandbox";
}

interface PaddleTransactionRequest {
  /** Paddle priceId (`pri_…`) for the chosen plan. */
  priceId: string;
  /** OXP user id; round-trips back via webhook custom_data. */
  userId: string;
  email: string;
  /** URL Paddle redirects to after a successful checkout. */
  successUrl: string;
}

export interface PaddleTransactionResponse {
  transactionId: string;
  /** Hosted-checkout URL Paddle generated for this transaction. */
  checkoutUrl: string | null;
}

/**
 * Create a one-shot checkout transaction in Paddle and return its id +
 * hosted checkout URL. Caller decides whether to redirect or open the
 * Paddle.js overlay client-side.
 */
export async function createCheckoutTransaction(
  req: PaddleTransactionRequest,
): Promise<PaddleTransactionResponse> {
  if (!PADDLE_API_KEY) {
    throw new Error(
      "PADDLE_API_KEY is not set — billing endpoints are disabled.",
    );
  }
  const res = await fetch(`${PADDLE_API_BASE}/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${PADDLE_API_KEY}`,
    },
    body: JSON.stringify({
      items: [{ price_id: req.priceId, quantity: 1 }],
      customer: { email: req.email },
      custom_data: { userId: req.userId },
      checkout: { url: req.successUrl },
      collection_mode: "automatic",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `paddle.transactions.create failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    data?: {
      id?: string;
      checkout?: { url?: string | null } | null;
    };
  };
  return {
    transactionId: json.data?.id ?? "",
    checkoutUrl: json.data?.checkout?.url ?? null,
  };
}

/**
 * Verify a Paddle webhook against the notification secret. Returns true
 * iff the supplied raw body has a valid HMAC for the signed timestamp.
 *
 * Defends against:
 *  - missing / malformed signature header → reject
 *  - clock-skewed replays → reject if `ts` is more than 5 min from now
 *  - timing attacks → constant-time compare
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): { ok: true; ts: number } | { ok: false; reason: string } {
  if (!PADDLE_WEBHOOK_SECRET) {
    return { ok: false, reason: "PADDLE_WEBHOOK_SECRET is not configured" };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "missing Paddle-Signature header" };
  }
  const parts = signatureHeader.split(";").map((p) => p.trim());
  const tsPart = parts.find((p) => p.startsWith("ts="));
  const h1Part = parts.find((p) => p.startsWith("h1="));
  if (!tsPart || !h1Part) {
    return { ok: false, reason: "malformed Paddle-Signature header" };
  }
  const ts = Number(tsPart.slice(3));
  const h1 = h1Part.slice(3);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "non-numeric ts in signature" };
  }
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSec > 5 * 60) {
    return { ok: false, reason: `signature too old (${ageSec}s)` };
  }
  const expected = createHmac("sha256", PADDLE_WEBHOOK_SECRET)
    .update(`${ts}:${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(h1, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "hmac mismatch" };
  }
  return { ok: true, ts };
}

// ── Subscription event payloads (only the fields we actually consume) ──

export interface PaddleSubscriptionPayload {
  id: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "paused" | string;
  customer_id: string;
  items?: Array<{
    price?: {
      id?: string;
      unit_price?: { amount?: string; currency_code?: string } | null;
    } | null;
  }>;
  current_billing_period?: {
    starts_at?: string;
    ends_at?: string;
  } | null;
  scheduled_change?: {
    action: "cancel" | "pause" | "resume" | string;
    effective_at?: string;
  } | null;
  custom_data?: Record<string, unknown> | null;
}

export interface PaddleWebhookEvent {
  event_type: string;
  data: PaddleSubscriptionPayload | Record<string, unknown>;
}

export interface PaddleManagementUrls {
  /** Hosted page where the customer can cancel the subscription. */
  cancel: string | null;
  /** Hosted page where the customer can update their payment method. */
  update_payment_method: string | null;
}

/**
 * Fetch a subscription from Paddle and return the customer-facing
 * management URLs Paddle generates for it. Used by /api/billing/portal so
 * the dashboard can deep-link Pro / Teams customers straight to "Cancel"
 * or "Update card" without us re-implementing those flows.
 */
export async function getSubscriptionManagementUrls(
  subscriptionId: string,
): Promise<PaddleManagementUrls> {
  if (!PADDLE_API_KEY) {
    throw new Error(
      "PADDLE_API_KEY is not set — billing endpoints are disabled.",
    );
  }
  const res = await fetch(
    `${PADDLE_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { authorization: `Bearer ${PADDLE_API_KEY}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `paddle.subscriptions.get failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    data?: {
      management_urls?: {
        cancel?: string | null;
        update_payment_method?: string | null;
      } | null;
    };
  };
  return {
    cancel: json.data?.management_urls?.cancel ?? null,
    update_payment_method:
      json.data?.management_urls?.update_payment_method ?? null,
  };
}
