import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How oxp.sh collects, uses, retains, and protects your personal data — fully aligned with GDPR Article 13.",
};

const EFFECTIVE_DATE = "6 May 2026";

export default function PrivacyPage() {
  return (
    <>
      <p className="meta">
        Effective date: {EFFECTIVE_DATE} · Version 1.0 · GDPR Article 13
      </p>

      <div className="callout">
        <p>
          <strong>Short version.</strong> We collect the minimum needed to run
          the registry: your account details, the things you publish, basic
          usage telemetry, and (for paid plans) billing metadata. We never sell
          your data. You can export or delete everything at any time by emailing{" "}
          <a href="mailto:privacy@oxp.sh">privacy@oxp.sh</a>.
        </p>
      </div>

      <h2>1. Controller &amp; contact</h2>
      <p>
        The data controller for personal data processed through oxp.sh is the
        operator of OXP (&ldquo;we&rdquo;, &ldquo;us&rdquo;). For privacy
        questions, GDPR requests, or to contact our Data Protection point of
        contact, write to <a href="mailto:privacy@oxp.sh">privacy@oxp.sh</a>.
      </p>

      <h2>2. What we collect &amp; why</h2>
      <p>
        We process the following categories of personal data on the legal bases
        shown:
      </p>
      <dl>
        <dt>Account data</dt>
        <dd>
          Handle, email address, hashed password, optional display name and
          avatar. Used to authenticate you and contact you about the Service.{" "}
          <em>Legal basis: contract performance (Art. 6(1)(b)).</em>
        </dd>
        <dt>Identity verification</dt>
        <dd>
          GitHub login, GitHub user ID, DNS challenge proofs, and the trust
          level we computed from them. Used to confirm publisher identity and
          prevent name squatting.{" "}
          <em>
            Legal basis: contract performance and our legitimate interest in
            registry integrity (Art. 6(1)(b) and (f)).
          </em>
        </dd>
        <dt>Published content</dt>
        <dd>
          Extension and MCP server metadata, descriptions, README, icons, and
          binary artifacts you upload. Public extensions are visible to
          everyone; private extensions are visible only to you and members you
          grant access.{" "}
          <em>Legal basis: contract performance (Art. 6(1)(b)).</em>
        </dd>
        <dt>Usage telemetry</dt>
        <dd>
          Aggregated install counts, page views, and search terms. IP address
          and user-agent are processed transiently for security (rate limiting,
          abuse detection) and are not retained beyond 30 days tied to your
          account.{" "}
          <em>
            Legal basis: legitimate interest in operating and securing the
            Service (Art. 6(1)(f)).
          </em>
        </dd>
        <dt>Billing data</dt>
        <dd>
          Plan selection, subscription status, Paddle customer/subscription
          identifiers, last-four card digits as displayed by Paddle, billing
          country, VAT number (if supplied), and invoice history. We do not see
          or store full payment-card details — those are handled by{" "}
          <strong>Paddle.com Market Limited</strong> (merchant of record).{" "}
          <em>
            Legal basis: contract performance and legal obligation (Art. 6(1)(b)
            and (c) — invoice retention).
          </em>
        </dd>
        <dt>Support correspondence</dt>
        <dd>
          Emails and tickets you send us, plus our replies.{" "}
          <em>
            Legal basis: legitimate interest in providing support (Art.
            6(1)(f)).
          </em>
        </dd>
        <dt>Cookies &amp; similar technologies</dt>
        <dd>
          Strictly-necessary cookies for sign-in sessions and CSRF protection.
          We do not use advertising cookies or cross-site trackers and we do not
          need a consent banner for this set.{" "}
          <em>
            Legal basis: necessary for the service requested (ePrivacy Directive
            Art. 5(3) exception).
          </em>
        </dd>
      </dl>

      <h2>3. Where the data lives — sub-processors</h2>
      <p>
        We rely on a small set of vetted sub-processors. Each is bound by a Data
        Processing Agreement and standard contractual clauses where applicable:
      </p>
      <ul>
        <li>
          <strong>Neon, Inc.</strong> &mdash; managed PostgreSQL hosting in the
          EU region (Frankfurt). Stores account, billing, and registry metadata.
        </li>
        <li>
          <strong>Cloudflare, Inc.</strong> &mdash; R2 object storage and global
          CDN for extension binaries, icons, and static assets. Cloudflare also
          provides DDoS protection on the edge.
        </li>
        <li>
          <strong>Paddle.com Market Limited</strong> &mdash; payment processor
          and merchant of record for all paid subscriptions. Paddle collects
          payment, billing address, and VAT data directly from you and shares
          with us only the limited subset needed to provision your plan. See{" "}
          <a
            href="https://www.paddle.com/legal/privacy"
            target="_blank"
            rel="noreferrer"
          >
            paddle.com/legal/privacy
          </a>
          .
        </li>
        <li>
          <strong>Email delivery provider</strong> &mdash; for transactional
          messages (verification, security alerts, receipts).
        </li>
      </ul>
      <p>
        We do not sell, rent, or otherwise share personal data with third-party
        advertisers. International transfers (e.g. to Cloudflare infrastructure
        outside the EEA) are covered by the European Commission&rsquo;s Standard
        Contractual Clauses.
      </p>

      <h2>4. How long we keep it</h2>
      <ul>
        <li>
          <strong>Active account data</strong> &mdash; for as long as your
          account exists, plus a 30-day grace window after deletion.
        </li>
        <li>
          <strong>Public extension publications</strong> &mdash; retained
          indefinitely so that consumers who installed your extension can
          continue to receive it. You can request unlisting (the extension is
          hidden from search and installs) or full deletion (the artifacts are
          removed). Deletion may be subject to a short archival period for
          security forensics.
        </li>
        <li>
          <strong>Billing &amp; invoice records</strong> &mdash; retained for 10
          years after the last transaction to comply with EU tax law.
        </li>
        <li>
          <strong>Server access logs &amp; security events</strong> &mdash;
          maximum 30 days.
        </li>
        <li>
          <strong>Support correspondence</strong> &mdash; up to 24 months after
          the last interaction.
        </li>
      </ul>

      <h2>5. Your rights under the GDPR</h2>
      <p>
        You have the right to (a) access the personal data we hold on you, (b)
        request rectification of inaccurate data, (c) request erasure
        (&ldquo;right to be forgotten&rdquo;), (d) request restriction of
        processing, (e) object to processing based on legitimate interest, (f)
        receive a copy of your data in a portable, machine-readable format, and
        (g) withdraw consent where processing is based on consent (without
        affecting the lawfulness of prior processing).
      </p>
      <p>
        To exercise any of these rights, email{" "}
        <a href="mailto:privacy@oxp.sh">privacy@oxp.sh</a> from the address
        registered on your account. We will respond within 30 days. If you
        believe we have mishandled your data you have the right to lodge a
        complaint with your national supervisory authority. The list of EU
        authorities is available at{" "}
        <a
          href="https://edpb.europa.eu/about-edpb/about-edpb/members_en"
          target="_blank"
          rel="noreferrer"
        >
          edpb.europa.eu/about-edpb/about-edpb/members_en
        </a>
        .
      </p>

      <h2>6. Automated decision-making</h2>
      <p>
        We do not subject you to decisions based solely on automated processing
        that produce legal or similarly significant effects on you. Automated
        checks (e.g. malware scanning of uploaded artifacts, rate-limit blocks)
        are reviewable by a human on request.
      </p>

      <h2>7. Security</h2>
      <p>
        We follow industry-standard security practices: TLS in transit,
        encryption at rest for the database and object storage, hashed passwords
        (Argon2 or bcrypt), least-privilege IAM, isolated WASM sandboxes for
        extension execution, signed releases via Sigstore, vulnerability
        monitoring, and regular backups with tested restores. Report suspected
        vulnerabilities to <a href="mailto:security@oxp.sh">security@oxp.sh</a>.
        In the event of a personal-data breach affecting you we will notify the
        competent supervisory authority within 72 hours and inform you without
        undue delay where required.
      </p>

      <h2>8. Children</h2>
      <p>
        The Service is not directed to children under 16. We do not knowingly
        collect personal data from children. If you believe a child has provided
        us data, contact us and we will delete it.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We will announce material changes at least 30 days before they take
        effect, by email to your registered address and via an in-product
        banner. The current version and effective date are shown at the top of
        this page; previous versions are available on request.
      </p>

      <h2>10. Contact</h2>
      <p>
        Privacy questions and GDPR requests:{" "}
        <a href="mailto:privacy@oxp.sh">privacy@oxp.sh</a>. Security:{" "}
        <a href="mailto:security@oxp.sh">security@oxp.sh</a>.
      </p>
    </>
  );
}
