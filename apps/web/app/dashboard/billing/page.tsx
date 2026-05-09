/**
 * /dashboard/billing — plan summary + Paddle-hosted "manage" deep links.
 *
 * Free users get an Upgrade CTA back to /pricing.
 * Pro / Teams users get the live cancel + update-payment URLs that
 * Paddle generates for their subscription, plus a one-shot fetch from
 * /api/billing/portal so the URLs are always fresh.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserPlan, PLANS, formatPrice } from "@/lib/billing";
import {
  getSubscriptionManagementUrls,
  isPaddleConfigured,
} from "@/lib/paddle";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/dashboard/billing");

  const plan = await getUserPlan(me.id);
  const def = PLANS[plan.plan];

  let cancelUrl: string | null = null;
  let updateUrl: string | null = null;
  let portalError: string | null = null;
  if (plan.plan !== "free" && plan.paddleSubId && isPaddleConfigured()) {
    try {
      const urls = await getSubscriptionManagementUrls(plan.paddleSubId);
      cancelUrl = urls.cancel;
      updateUrl = urls.update_payment_method;
    } catch (err) {
      portalError = err instanceof Error ? err.message : "Paddle error";
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-mono text-sky-200">
      <h1 className="text-2xl tracking-[0.18em] uppercase mb-2">Billing</h1>
      <p className="text-xs text-sky-300/60 mb-8">
        Manage your OXP subscription. All payment data lives in Paddle — we only
        store the subscription id and current plan.
      </p>

      <section className="hud-card px-6 py-6 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] tracking-[0.2em] uppercase text-sky-300/50 mb-1">
              Current plan
            </div>
            <div className="text-xl text-sky-100">{def.name}</div>
            <div className="text-xs text-sky-300/60 mt-1">
              {formatPrice(def.priceCentsEur)} · {def.cadence}
            </div>
          </div>
          <div className="text-right text-xs text-sky-300/60">
            <div>
              Status: <span className="text-sky-100">{plan.status}</span>
            </div>
            <div>
              Renews:{" "}
              <span className="text-sky-100">
                {plan.currentPeriodEnd.toISOString().slice(0, 10)}
              </span>
            </div>
            {plan.cancelAt ? (
              <div className="text-amber-200">
                Cancels {plan.cancelAt.toISOString().slice(0, 10)}
              </div>
            ) : null}
            {plan.seats > 1 ? (
              <div>
                Seats: <span className="text-sky-100">{plan.seats}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {plan.plan === "free" ? (
        <section className="hud-card px-6 py-6">
          <p className="text-sm text-sky-300/70 mb-4">
            You&apos;re on the free plan. Upgrade for private extensions, org
            features, audit logs, SSO, and more bandwidth.
          </p>
          <Link
            href="/pricing"
            className="inline-flex items-center px-5 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10"
          >
            See plans →
          </Link>
        </section>
      ) : (
        <section className="hud-card px-6 py-6 space-y-4">
          {portalError ? (
            <div className="text-xs text-red-300 border border-red-400/30 bg-red-500/5 px-3 py-2">
              Couldn&apos;t reach Paddle: {portalError}
            </div>
          ) : null}
          {!plan.paddleSubId ? (
            <div className="text-xs text-amber-200 border border-amber-400/30 bg-amber-500/5 px-3 py-2">
              Subscription not yet linked to Paddle. The webhook should arrive
              within a minute of checkout.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {updateUrl ? (
              <a
                href={updateUrl}
                className="inline-flex items-center px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10"
              >
                Update payment method →
              </a>
            ) : null}
            {cancelUrl ? (
              <a
                href={cancelUrl}
                className="inline-flex items-center px-4 py-2 text-xs tracking-[0.2em] uppercase border border-red-400/40 text-red-200 hover:bg-red-500/10"
              >
                Cancel subscription →
              </a>
            ) : null}
            <Link
              href="/pricing"
              className="inline-flex items-center px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/20 text-sky-300/70 hover:text-sky-100"
            >
              Change plan →
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
