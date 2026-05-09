/**
 * Subprocessor list. Linked from /trust. Updated with 30-day notice when
 * any vendor is added or removed.
 */

import Link from "next/link";

export const metadata = { title: "Subprocessors · OXP" };

const SUBPROCESSORS: {
  vendor: string;
  purpose: string;
  region: string;
  data: string;
  link: string;
}[] = [
  {
    vendor: "Neon",
    purpose: "Managed Postgres (registry, accounts, audit log)",
    region: "EU (Frankfurt)",
    data: "Account profile, package metadata, signed bundle digests, audit events.",
    link: "https://neon.tech/dpa",
  },
  {
    vendor: "Cloudflare",
    purpose: "Edge proxy, WAF, DDoS, CDN for static assets",
    region: "Global edge; EU/US ingress",
    data: "Request metadata (IP, UA, path); no bundle bytes cached.",
    link: "https://www.cloudflare.com/cloudflare-customer-dpa/",
  },
  {
    vendor: "Paddle",
    purpose: "Merchant of record, billing, tax, invoicing",
    region: "EU/US",
    data: "Customer name, billing email, country, payment method token.",
    link: "https://www.paddle.com/legal/dpa",
  },
  {
    vendor: "Postmark",
    purpose: "Transactional email (verify, reset, security alerts)",
    region: "US",
    data: "Email address, message body for the specific transactional event.",
    link: "https://postmarkapp.com/dpa",
  },
  {
    vendor: "Vercel",
    purpose: "Web app hosting (oxp.sh, dashboard, docs)",
    region: "Global edge; EU/US compute",
    data: "Request logs (IP, UA, path); no DB rows.",
    link: "https://vercel.com/legal/dpa",
  },
];

export default function SubprocessorsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-mono text-sky-200">
      <p className="text-xs tracking-[0.2em] text-sky-300/50 uppercase">
        / trust / subprocessors
      </p>
      <h1 className="text-3xl tracking-[0.18em] uppercase mt-2 mb-3">
        Subprocessor list
      </h1>
      <p className="text-xs tracking-[0.2em] uppercase text-sky-300/40 mb-8">
        Last updated 25 May 2026
      </p>

      <p className="text-sm text-sky-300/70 leading-relaxed mb-10">
        OXP relies on the third parties below to operate the registry and the
        oxp.sh web app. We give 30 days&apos; notice on{" "}
        <Link className="text-cyan-300" href="/trust">
          /trust
        </Link>{" "}
        before adding or removing any subprocessor. Enterprise customers may
        request the signed list with notification webhook.
      </p>

      <ul className="space-y-4">
        {SUBPROCESSORS.map((s) => (
          <li key={s.vendor} className="hud-card p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100">
                {s.vendor}
              </h2>
              <a
                href={s.link}
                target="_blank"
                rel="noreferrer"
                className="text-xs tracking-[0.2em] uppercase text-cyan-300 hover:text-cyan-200"
              >
                DPA ↗
              </a>
            </div>
            <p className="mt-2 text-sm text-sky-200/80 leading-relaxed">
              {s.purpose}
            </p>
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-sky-300/70">
              <div>
                <dt className="uppercase tracking-[0.2em] text-sky-300/40">
                  Region
                </dt>
                <dd className="mt-1">{s.region}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-[0.2em] text-sky-300/40">
                  Data categories
                </dt>
                <dd className="mt-1">{s.data}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <section className="mt-12 hud-card p-5">
        <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100 mb-3">
          Change notification
        </h2>
        <p className="text-sm text-sky-200/80 leading-relaxed">
          Email{" "}
          <a
            className="text-cyan-300"
            href="mailto:sales@oxp.sh?subject=Subprocessor%20change%20notification"
          >
            sales@oxp.sh
          </a>{" "}
          with subject &quot;Subprocessor change notification&quot; to receive
          30-day advance email whenever this list changes.
        </p>
      </section>

      <p className="mt-12 text-xs tracking-[0.2em] uppercase text-sky-300/40">
        ←{" "}
        <Link className="text-cyan-300" href="/trust">
          back to trust
        </Link>
      </p>
    </main>
  );
}
