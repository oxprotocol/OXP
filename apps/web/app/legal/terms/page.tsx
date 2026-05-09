import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing your use of oxp.sh — the registry, hosted services, CLI, and paid subscriptions.",
};

const EFFECTIVE_DATE = "6 May 2026";

export default function TermsPage() {
  return (
    <>
      <p className="meta">Effective date: {EFFECTIVE_DATE} · Version 1.0</p>

      <h2>1. Who we are</h2>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) form a binding agreement
        between you (&ldquo;Customer&rdquo;, &ldquo;you&rdquo;) and the operator
        of oxp.sh (&ldquo;OXP&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). The
        Service consists of the public extension registry, web dashboard, CLI,
        SDKs, host adapters (VS Code, JetBrains, Neovim, Piye), and any paid
        subscription plans listed on <a href="/pricing">/pricing</a>{" "}
        (collectively, the &ldquo;Service&rdquo;).
      </p>
      <p>
        By creating an account, installing the CLI, publishing an extension, or
        otherwise using the Service you accept these Terms. If you are accepting
        on behalf of an organisation you represent that you have authority to
        bind that organisation.
      </p>
      <p>
        For billing questions, the merchant of record is Paddle.com Market
        Limited (&ldquo;Paddle&rdquo;), see{" "}
        <a href="/legal/refund">our refund policy</a> and Paddle&rsquo;s own
        buyer terms at{" "}
        <a
          href="https://www.paddle.com/legal/checkout-buyer-terms"
          target="_blank"
          rel="noreferrer"
        >
          paddle.com/legal/checkout-buyer-terms
        </a>
        .
      </p>

      <h2>2. Eligibility &amp; accounts</h2>
      <p>
        You must be at least 16 years old (or the age of digital consent in your
        jurisdiction) to use the Service. You are responsible for keeping your
        credentials, API tokens, and any signing keys confidential and for all
        activity under your account. Notify us immediately at{" "}
        <a href="mailto:security@oxp.sh">security@oxp.sh</a> if you suspect
        unauthorised access.
      </p>

      <h2>3. The Free plan and paid Subscriptions</h2>
      <p>
        Every account is created on the Free plan automatically. Paid plans
        (Pro, Teams, Enterprise) are sold as monthly or annual subscriptions
        through Paddle. Prices, included quotas, and the features bundled with
        each plan are described on <a href="/pricing">/pricing</a> and are part
        of these Terms by reference. Items marked &ldquo;Soon&rdquo; on that
        page are roadmap features and not currently enforced or guaranteed.
      </p>
      <p>
        Subscriptions renew automatically for successive periods of the same
        length unless cancelled before the end of the current period. Applicable
        VAT or other indirect taxes are calculated and charged by Paddle based
        on your declared billing location.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to, and not to allow any third party to:</p>
      <ul>
        <li>
          publish extensions, MCP servers, or content that contain malware,
          credential harvesters, cryptocurrency miners running without end-user
          consent, or any code designed to bypass host security controls;
        </li>
        <li>
          infringe intellectual property, privacy, or publicity rights, or
          publish content that is unlawful, defamatory, or harmful to minors;
        </li>
        <li>
          interfere with the Service, attempt to access another customer&rsquo;s
          data, scan for vulnerabilities without prior written consent
          (responsible disclosure to{" "}
          <a href="mailto:security@oxp.sh">security@oxp.sh</a> is welcome), or
          run sustained automated traffic against the registry beyond documented
          rate limits;
        </li>
        <li>
          re-sell, sub-license, or otherwise commercially redistribute the
          Service except as expressly permitted by your plan;
        </li>
        <li>
          use the Service to develop a competing extension registry by
          systematically copying our metadata, ratings, or curation.
        </li>
      </ul>

      <h2>5. Your content &amp; licence to OXP</h2>
      <p>
        You retain all intellectual property rights in the extensions, MCP
        configurations, documentation, screenshots, and other materials you
        upload (&ldquo;Customer Content&rdquo;). You grant OXP a worldwide,
        royalty-free, non-exclusive licence to host, copy, transmit, display,
        and distribute Customer Content solely as necessary to operate and
        promote the Service (including CDN distribution, search indexing,
        package mirroring, and showing your listing on category pages).
      </p>
      <p>
        Open-source extensions you publish to the public registry must be
        distributed under an OSI-approved licence that allows redistribution and
        installation by end users. Private extensions remain visible only to you
        and members you grant access.
      </p>

      <h2>6. Our intellectual property</h2>
      <p>
        The OXP name, logo, the protocol specification, the registry software,
        the CLI, the SDKs, and the host adapters are owned by OXP or its
        licensors. The protocol specification (in <code>/spec/v1</code>) and the
        SDKs are released under permissive open-source licences as documented in
        the relevant repositories; nothing in these Terms restricts your rights
        under those licences. All other rights are reserved.
      </p>

      <h2>7. Suspension &amp; termination</h2>
      <p>
        We may suspend or terminate your access if you materially breach these
        Terms (including any acceptable-use violation), if your payment method
        fails repeatedly, if required by law, or if continuing the Service would
        expose us or other users to legal or security risk. We will give
        reasonable prior notice where possible.
      </p>
      <p>
        You may close your account at any time from the dashboard or by emailing{" "}
        <a href="mailto:support@oxp.sh">support@oxp.sh</a>. On termination we
        will retain your data only for the periods set out in the{" "}
        <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>8. Service availability &amp; support</h2>
      <p>
        We use commercially reasonable efforts to keep the Service available.
        Specific uptime commitments apply only to paid plans as published on{" "}
        <a href="/pricing">/pricing</a>. The Free plan is provided &ldquo;as
        available&rdquo; with community support only.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        Except as required by mandatory consumer-protection law, the Service is
        provided &ldquo;as is&rdquo; without warranties of any kind, express or
        implied, including merchantability, fitness for a particular purpose,
        and non-infringement. We do not warrant that the Service will be
        uninterrupted or error-free, or that any third-party extension you
        install will be safe, secure, or functional.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, neither party will be liable for
        indirect, incidental, special, consequential, or punitive damages, or
        for lost profits, revenue, or data. Our aggregate liability under these
        Terms in any 12-month period will not exceed the greater of (a) the fees
        you actually paid us in that period, or (b) one hundred euros
        (&euro;100). Nothing in these Terms limits liability for fraud, gross
        negligence, death, or personal injury, or any liability that cannot be
        limited under applicable law.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        You will defend and indemnify OXP against third-party claims arising
        from (i) Customer Content you publish, (ii) your breach of these Terms,
        or (iii) your violation of applicable law, provided that we give you
        prompt notice and reasonable cooperation.
      </p>

      <h2>12. Changes to the Service or these Terms</h2>
      <p>
        We may update these Terms by giving at least 30 days&rsquo; notice (by
        email and/or in-product banner) for material changes. Continued use
        after the effective date constitutes acceptance. If you do not agree,
        you may cancel your subscription before the change takes effect for a
        pro-rata refund of the unused remainder.
      </p>

      <h2>13. Governing law &amp; disputes</h2>
      <p>
        These Terms are governed by the laws of Ireland, without regard to
        conflict-of-laws rules. Mandatory consumer-protection rights in your
        country of residence are not affected. Disputes will be brought before
        the competent courts of Dublin, Ireland, except where consumer law gives
        you the right to bring proceedings in your local courts.
      </p>
      <p>
        EU consumers may also use the European Commission&rsquo;s online
        dispute-resolution platform at{" "}
        <a
          href="https://ec.europa.eu/consumers/odr"
          target="_blank"
          rel="noreferrer"
        >
          ec.europa.eu/consumers/odr
        </a>
        .
      </p>

      <h2>14. Contact</h2>
      <p>
        Legal notices: <a href="mailto:legal@oxp.sh">legal@oxp.sh</a>.
        Operational support: <a href="mailto:support@oxp.sh">support@oxp.sh</a>.
        Security: <a href="mailto:security@oxp.sh">security@oxp.sh</a>.
      </p>
    </>
  );
}
