import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "Refund and cancellation policy for oxp.sh subscriptions, including the 14-day EU cooling-off period for digital services.",
};

const EFFECTIVE_DATE = "6 May 2026";

export default function RefundPage() {
  return (
    <>
      <p className="meta">
        Effective date: {EFFECTIVE_DATE} · Version 1.0 · Paddle-compatible
      </p>

      <div className="callout">
        <p>
          <strong>The short answer.</strong> If you&rsquo;re an EU consumer, you
          can cancel any new subscription within 14 days for a full refund
          &mdash; provided you haven&rsquo;t exceeded the trivial-use threshold
          described below. After that window, subscriptions are billed in
          advance and we issue a pro-rata refund of the unused remainder when
          you cancel mid-period.
        </p>
      </div>

      <h2>1. Merchant of record</h2>
      <p>
        All paid subscriptions to oxp.sh are sold through{" "}
        <strong>Paddle.com Market Limited</strong> (&ldquo;Paddle&rdquo;), our
        payment processor and EU merchant of record. Paddle handles billing,
        VAT, and refund execution. This policy describes the conditions under
        which we authorise refunds; the mechanics of payment are governed by{" "}
        <a
          href="https://www.paddle.com/legal/checkout-buyer-terms"
          target="_blank"
          rel="noreferrer"
        >
          Paddle&rsquo;s buyer terms
        </a>
        .
      </p>

      <h2>2. The 14-day EU cooling-off period</h2>
      <p>
        Under the EU Consumer Rights Directive (2011/83/EU), consumers in the
        European Union and the United Kingdom have a statutory right to withdraw
        from a contract for digital services within 14 days of the contract
        being concluded, without giving a reason.
      </p>
      <p>
        <strong>How to exercise it:</strong> email{" "}
        <a href="mailto:billing@oxp.sh">billing@oxp.sh</a> from the address on
        your account stating that you wish to withdraw, or use the{" "}
        <em>Cancel subscription</em> action in your dashboard. We will instruct
        Paddle to refund the full amount paid within 14 days of receiving your
        request, using the same payment method.
      </p>
      <p>
        <strong>The trivial-use exception (Art. 16(m)).</strong> If you actively
        use the paid features in a way that goes beyond inspection &mdash; for
        example, by publishing more than three private extensions, inviting more
        than two paid seats to an organisation, consuming more than 10 GB of CDN
        bandwidth on the Pro plan, or consuming more than 50 GB on the Teams
        plan &mdash; you are deemed to have consented to immediate performance
        and accepted that you lose the right of withdrawal under Art. 16(m). In
        that case the pro-rata rules in section&nbsp;3 apply instead. We never
        apply this exception silently: if you ask for a withdrawal refund and we
        believe the exception applies, we will explain why and offer the
        pro-rata refund as an alternative.
      </p>

      <h2>3. Cancelling outside the cooling-off window</h2>
      <p>
        You can cancel any subscription at any time from the dashboard. After
        the 14-day window:
      </p>
      <ul>
        <li>
          <strong>Monthly plans</strong> &mdash; on cancellation we issue a
          pro-rata refund for the unused days of the current billing month. For
          example, cancelling on day 10 of a 30-day cycle returns roughly
          two-thirds of that month&rsquo;s fee. The refund excludes any add-ons
          or overage charges already consumed.
        </li>
        <li>
          <strong>Annual plans</strong> &mdash; we refund the unused remainder
          calculated on a daily basis, less any volume discount you received
          compared to the equivalent monthly price. Your access continues until
          the end of the period unless you ask us to terminate immediately.
        </li>
        <li>
          <strong>Enterprise contracts</strong> &mdash; refund and cancellation
          terms are governed by the master services agreement you signed; this
          policy does not apply.
        </li>
      </ul>

      <h2>4. When refunds are not available</h2>
      <p>We cannot refund:</p>
      <ul>
        <li>
          one-time fees for completed services (e.g. a paid manual review or a
          custom-domain provisioning fee that has already been fulfilled);
        </li>
        <li>
          subscriptions terminated by us for material breach of the{" "}
          <a href="/legal/terms">Terms of Service</a> &mdash; for example,
          publishing malware, infringing content, or violating acceptable-use
          rules;
        </li>
        <li>
          fees from prior billing periods that you did not contest within 60
          days of the relevant invoice date;
        </li>
        <li>
          third-party charges, including bank fees, currency-conversion spreads,
          and chargeback recovery costs.
        </li>
      </ul>

      <h2>5. Failed payments &amp; involuntary churn</h2>
      <p>
        If a renewal payment fails Paddle will retry over a 7-day window and
        notify you by email. If we cannot collect after the retry window your
        subscription is downgraded to the Free plan; private extensions remain
        stored but become unlisted until billing is restored. We do not delete
        content for non-payment.
      </p>

      <h2>6. VAT &amp; taxes</h2>
      <p>
        Paddle applies VAT or local sales tax based on your declared billing
        location. Refunds include the corresponding tax amount. If you supplied
        a valid VAT number (B2B reverse charge), the refund will reflect the net
        amount paid.
      </p>

      <h2>7. How to request a refund</h2>
      <p>
        Email <a href="mailto:billing@oxp.sh">billing@oxp.sh</a> from the
        address registered on your account, or open a support ticket from the
        dashboard. Please include:
      </p>
      <ol>
        <li>
          your account handle (<code>@you</code>);
        </li>
        <li>the Paddle order reference (visible in your receipt email);</li>
        <li>a one-line reason &mdash; not required, but helps us improve.</li>
      </ol>
      <p>
        We acknowledge requests within 2 business days and instruct Paddle to
        issue refunds within 14 days. Funds typically reach your card within
        5&ndash;10 banking days after that, depending on your issuer.
      </p>

      <h2>8. Chargebacks</h2>
      <p>
        Please contact us before initiating a chargeback &mdash; we can almost
        always resolve issues faster directly. Chargebacks raised without prior
        contact may result in account suspension while we work with Paddle to
        investigate.
      </p>

      <h2>9. Contact</h2>
      <p>
        Refund &amp; billing questions:{" "}
        <a href="mailto:billing@oxp.sh">billing@oxp.sh</a>. Sales and Enterprise
        contracts: <a href="mailto:sales@oxp.sh">sales@oxp.sh</a>.
      </p>
    </>
  );
}
