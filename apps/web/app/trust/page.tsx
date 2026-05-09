/**
 * Trust + compliance page. Lists actual security controls in place
 * (linked to source where possible) and links to the GDPR DPA + MSA
 * templates that Enterprise customers can request via sales@oxp.sh.
 */

export const metadata = { title: "Trust · OXP" };

const CONTROLS: {
  title: string;
  status: "live" | "planned";
  detail: string;
  link?: string;
}[] = [
  {
    title: "AES-256-GCM at-rest secret encryption",
    status: "live",
    detail:
      "All SSO, storage, and KMS credentials are envelope-encrypted with a server-held master key before persistence.",
    link: "/security#secrets",
  },
  {
    title: "TLS 1.2+ in transit",
    status: "live",
    detail: "Edge proxy enforces TLS 1.2 minimum; HSTS preload on oxp.sh.",
  },
  {
    title: "WASM sandbox for extension code",
    status: "live",
    detail:
      "Untrusted extension logic runs inside a Wasmtime component with no host syscalls.",
    link: "/security#sandbox",
  },
  {
    title: "Sigstore-signed releases",
    status: "live",
    detail:
      "Every published bundle is signed; publishers can bring their own KMS key.",
    link: "/security#signing",
  },
  {
    title: "GDPR Data Processing Agreement",
    status: "live",
    detail:
      "Standard DPA available to Pro/Teams/Enterprise customers on request via sales@oxp.sh.",
  },
  {
    title: "Custom MSA + DPIA support",
    status: "live",
    detail:
      "Enterprise customers receive a tailored MSA, DPIA support, and named DPO contact.",
  },
  {
    title: "Sub-processor disclosure list",
    status: "live",
    detail:
      "Neon (database), Cloudflare (edge), Paddle (billing). Updates posted with 30-day notice.",
    link: "/trust/subprocessors",
  },
  {
    title: "Audit log retention",
    status: "live",
    detail: "30 days on Pro, 365 on Teams, unbounded on Enterprise.",
  },
  {
    title: "Bring-your-own object storage",
    status: "live",
    detail:
      "S3 / R2 / MinIO supported with mandatory smoke test before activation.",
    link: "/security#byo-storage",
  },
  {
    title: "Customer-managed signing keys",
    status: "live",
    detail:
      "AWS KMS today; GCP KMS, Azure Key Vault, and HashiCorp Vault next.",
  },
  {
    title: "SOC 2 Type II",
    status: "planned",
    detail:
      "Audit period scheduled. We don't claim certification we don't have. Contact sales for the current control narrative.",
  },
];

export default function TrustPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-mono text-sky-200">
      <p className="text-[10px] tracking-[0.2em] text-sky-300/50 uppercase">
        / trust
      </p>
      <h1 className="text-3xl tracking-[0.18em] uppercase mt-2 mb-8">
        Security &amp; compliance
      </h1>

      <p className="text-sm text-sky-300/70 leading-relaxed mb-10">
        Honest is better than aspirational. Below is what is live in production
        today vs. what is planned. Anything not on this page does not exist yet
        — please push back if a salesperson tells you otherwise.
      </p>

      <ul className="space-y-4">
        {CONTROLS.map((c) => (
          <li key={c.title} className="hud-card p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100">
                {c.title}
              </h2>
              <span
                className={`text-[10px] tracking-[0.2em] uppercase ${
                  c.status === "live" ? "text-cyan-300" : "text-amber-300/80"
                }`}
              >
                {c.status}
              </span>
            </div>
            <p className="mt-2 text-xs text-sky-300/70 leading-relaxed">
              {c.detail}
            </p>
            {c.link && (
              <a
                href={c.link}
                className="text-[11px] tracking-[0.18em] uppercase text-sky-300/80 hover:text-cyan-300 mt-3 inline-block"
              >
                Details →
              </a>
            )}
          </li>
        ))}
      </ul>

      <section className="mt-12 hud-card p-6">
        <h2 className="text-base tracking-[0.18em] uppercase mb-3">
          Documents
        </h2>
        <ul className="space-y-2 text-sm">
          <li>
            · DPA (GDPR + UK GDPR + Swiss FADP) — request:{" "}
            <a
              className="text-cyan-300"
              href="mailto:sales@oxp.sh?subject=DPA%20request"
            >
              sales@oxp.sh
            </a>
          </li>
          <li>
            · Custom MSA / SCCs — Enterprise:{" "}
            <a
              className="text-cyan-300"
              href="mailto:sales@oxp.sh?subject=MSA%20request"
            >
              sales@oxp.sh
            </a>
          </li>
          <li>
            · Subprocessor list —{" "}
            <a className="text-cyan-300" href="/trust/subprocessors">
              /trust/subprocessors
            </a>
          </li>
          <li>
            · Uptime SLA terms —{" "}
            <a className="text-cyan-300" href="/sla">
              /sla
            </a>
          </li>
          <li>
            · Vulnerability disclosure —{" "}
            <a className="text-cyan-300" href="/security">
              /security
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}
