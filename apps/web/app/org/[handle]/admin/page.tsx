/**
 * Org admin landing page. Lists the four advanced configuration surfaces
 * gated by plan. Available to org owners + admins.
 */
import Link from "next/link";
import { loadOrgContextOrRedirect } from "@/lib/org-auth";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ handle: string }>;
}

export default async function OrgAdmin({ params }: Props) {
  const { handle } = await params;
  const ctx = await loadOrgContextOrRedirect(handle);
  const isTeams = ctx.plan === "teams" || ctx.plan === "enterprise";
  const isEnt = ctx.plan === "enterprise";

  const cards = [
    {
      href: `/org/${handle}/admin/members`,
      title: "Members",
      hint: "Invite teammates, manage roles, and revoke access.",
      gated: false,
      gate: "All plans",
    },
    {
      href: `/org/${handle}/admin/audit`,
      title: "Audit log",
      hint: "Append-only record of every privileged change in this org.",
      gated: !isTeams,
      gate: "Teams+",
    },
    {
      href: `/org/${handle}/admin/sso`,
      title: "Single sign-on",
      hint: "SAML 2.0 or OIDC. Auto-provisions members on first login.",
      gated: !isTeams,
      gate: "Teams+",
    },
    {
      href: `/org/${handle}/admin/domain`,
      title: "Custom domain",
      hint: "Serve your registry on oxp.your-co.com via DNS TXT verification.",
      gated: !isTeams,
      gate: "Teams+",
    },
    {
      href: `/org/${handle}/admin/storage`,
      title: "Bring your own storage",
      hint: "Push extension blobs to your S3/R2/MinIO bucket.",
      gated: !isEnt,
      gate: "Enterprise",
    },
    {
      href: `/org/${handle}/admin/kms`,
      title: "Customer-managed signing",
      hint: "Sigstore signatures backed by your AWS KMS key.",
      gated: !isEnt,
      gate: "Enterprise",
    },
  ];

  return (
    <main className="mx-auto max-w-4xl px-6 py-16 font-mono text-sky-200">
      <h1 className="text-2xl tracking-[0.18em] uppercase mb-2">
        @{ctx.org.handle} / admin
      </h1>
      <p className="text-sm text-sky-300/60 mb-10">
        Plan: <span className="text-sky-200">{ctx.plan.toUpperCase()}</span>
      </p>
      <ul className="grid gap-4">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={c.gated ? "/pricing" : c.href}
              className="hud-card block px-5 py-4 hover:bg-sky-500/5 transition"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-base tracking-[0.18em] uppercase">
                  {c.title}
                </span>
                <span className="text-[10px] tracking-[0.2em] text-sky-300/50">
                  {c.gated ? `${c.gate} →` : "OPEN →"}
                </span>
              </div>
              <p className="text-xs text-sky-300/60 mt-2">{c.hint}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
