import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BadgeCheck,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  Code2,
  Globe,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import {
  evaluateClaim,
  loadCallerSignals,
  parseScopedId,
} from "@/lib/vsx-claim";
import { prisma } from "@/lib/prisma";
import { performClaim } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claim listing" };

interface PageProps {
  params: Promise<{ scopedId: string }>;
  searchParams: Promise<{ denied?: string }>;
}

export default async function ClaimPage({ params, searchParams }: PageProps) {
  const { scopedId: encoded } = await params;
  const { denied } = await searchParams;
  const scopedId = decodeURIComponent(encoded);

  const me = await getCurrentUser();
  if (!me) {
    redirect(`/signin?next=/dashboard/claim/${encoded}`);
  }

  const ctx = parseScopedId(scopedId);
  if (!ctx) {
    return (
      <Shell>
        <p className="text-sm font-mono auth-dim">
          Invalid scoped id. Claims are only available for <code>@vsx-*/*</code>{" "}
          listings.
        </p>
      </Shell>
    );
  }

  const ext = await prisma.extension.findUnique({
    where: {
      ownerHandle_slug: { ownerHandle: ctx.ownerHandle, slug: ctx.slug },
    },
    select: {
      id: true,
      title: true,
      description: true,
      repositoryUrl: true,
      sourceGithubOrg: true,
    },
  });

  const signals = await loadCallerSignals(me.handle, me.id);
  const verdict = await evaluateClaim({
    ctx,
    userId: me.id,
    callerGithubLogin: signals.githubLogin,
    callerLevel: signals.level,
    callerDomains: signals.domains,
  });

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-xs font-mono auth-dim uppercase tracking-wider mb-1">
          // Claim listing
        </p>
        <h1 className="text-2xl font-black auth-heading">{ctx.scopedId}</h1>
        {ext?.title && (
          <p className="auth-muted text-sm font-mono mt-1">{ext.title}</p>
        )}
      </header>

      {denied && (
        <Banner tone="warn">
          You can&rsquo;t auto-claim this listing yet. See requirements below —
          every path is self-serve.
        </Banner>
      )}

      <section className="hud-card hud-corners p-6 space-y-4">
        <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/70 uppercase">
          // Eligibility
        </h2>
        <ul className="space-y-3 text-sm font-mono">
          <Row
            ok={!!signals.githubLogin}
            label={
              signals.githubLogin
                ? `GitHub linked: @${signals.githubLogin}`
                : "GitHub not linked"
            }
            hint={
              signals.githubLogin
                ? null
                : "Link your GitHub identity from /dashboard/security."
            }
          />
          {ext?.sourceGithubOrg ? (
            <Row
              ok={
                !!signals.githubLogin &&
                (signals.githubLogin === ext.sourceGithubOrg ||
                  verdict.kind === "ok")
              }
              label={
                signals.githubLogin === ext.sourceGithubOrg
                  ? `You ARE @${ext.sourceGithubOrg}`
                  : `Required identity: @${ext.sourceGithubOrg}`
              }
              hint={
                signals.githubLogin &&
                signals.githubLogin !== ext.sourceGithubOrg
                  ? `Source repo: ${ext.repositoryUrl}. We checked github.com/${ext.sourceGithubOrg}/public_members/${signals.githubLogin} — ${verdict.kind === "ok" ? "you're a public member \u2713" : "not a public member."}`
                  : `Derived from this listing's repository.url at import time.`
              }
            />
          ) : (
            <Row
              ok={
                !!signals.githubLogin &&
                signals.githubLogin === ctx.vsxNamespace
              }
              label={
                signals.githubLogin === ctx.vsxNamespace
                  ? `GitHub login matches namespace (${ctx.vsxNamespace})`
                  : `Namespace required: ${ctx.vsxNamespace}`
              }
              hint={
                "No source repository was recorded for this listing \u2014 falling back to namespace match. Personal handles only."
              }
            />
          )}
          {ctx.reserved && (
            <Row
              ok={signals.level === "domain" && signals.domains.length > 0}
              label={
                signals.level === "domain"
                  ? `Domain verification active (${signals.domains.join(", ")})`
                  : "Reserved brand \u2014 domain proof required"
              }
              hint={
                signals.level !== "domain"
                  ? `@${ctx.vsxNamespace} is a reserved brand. Verify ownership of the brand domain to claim it.`
                  : null
              }
            />
          )}
        </ul>
      </section>

      <section className="mt-6">
        {verdict.kind === "ok" && (
          <form action={performClaim.bind(null, scopedId)}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-bold tracking-wider uppercase bg-emerald-400/10 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/20 transition"
            >
              <BadgeCheck className="w-4 h-4" />
              Transfer to @{me.handle}
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-xs font-mono auth-dim mt-3">
              {verdict.reason === "github_login_match" &&
                `Eligible: your verified GitHub login matches the required identity.`}
              {verdict.reason === "github_org_member" &&
                `Eligible: you're a public member of @${ext?.sourceGithubOrg}.`}
              {verdict.reason === "domain_match" &&
                `Eligible: you control the brand's domain.`}
            </p>
          </form>
        )}

        {verdict.kind === "needs_domain" && (
          <DomainProofPanel
            domain={verdict.domainHint}
            handle={me.handle}
            reserved={verdict.reason === "reserved_brand"}
            namespace={ctx.vsxNamespace}
          />
        )}

        {verdict.kind === "denied" && (
          <div className="space-y-4">
            <p className="text-sm font-mono text-rose-200/80">
              {verdict.reason === "no_github" &&
                "Link a GitHub identity first."}
              {verdict.reason === "github_mismatch" &&
                (verdict.detail || "Your GitHub login doesn't match.")}
              {verdict.reason === "already_claimed" &&
                "This listing has already been claimed."}
              {verdict.reason === "not_found" && "Listing not found."}
              {verdict.reason === "not_vsx" && "Not a VSX-imported listing."}
            </p>
            <div className="flex gap-2">
              {verdict.reason === "no_github" && (
                <Link
                  href="/dashboard/security"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20 transition"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  Verify with GitHub
                </Link>
              )}
              {verdict.reason === "github_mismatch" && ctx.reserved && (
                <Link
                  href="/dashboard/security"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 transition"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Verify domain
                </Link>
              )}
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono auth-dim hover:text-[#7DD3FC]"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        )}
      </section>
    </Shell>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-200"
      : "border-amber-400/30 bg-amber-400/5 text-amber-200";
  return (
    <div className={`mb-4 rounded border px-3 py-2 text-xs font-mono ${cls}`}>
      {children}
    </div>
  );
}

/**
 * Self-serve DNS-TXT instructions, shown when the caller can't auto-claim
 * via GitHub. Once they verify the domain in /dashboard/security and
 * return to this page, `evaluateClaim` will surface the green
 * "domain_match" path automatically. No admin involvement.
 */
function DomainProofPanel({
  domain,
  handle,
  reserved,
  namespace,
}: {
  domain: string;
  handle: string;
  reserved: boolean;
  namespace: string;
}) {
  return (
    <div className="rounded border border-emerald-400/30 bg-emerald-400/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-emerald-400" />
        <h3 className="auth-heading text-sm font-bold tracking-wider uppercase">
          Verify {domain} via DNS TXT
        </h3>
      </div>
      <p className="text-xs font-mono auth-muted leading-relaxed">
        {reserved ? (
          <>
            <code>@{namespace}</code> is a reserved brand. The only self-serve
            path is to prove control of <code>{domain}</code> with a DNS TXT
            record. The check is automatic \u2014 no humans involved.
          </>
        ) : (
          <>
            We don&rsquo;t have a recorded source repository for this listing
            and <code>@{namespace}</code> looks brand-prefixed, so we
            can&rsquo;t auto-match a GitHub identity. Verify control of a
            matching domain instead.
          </>
        )}
      </p>
      <ol className="text-xs font-mono auth-muted leading-relaxed list-decimal pl-5 space-y-2">
        <li>
          Go to{" "}
          <Link
            href={`/dashboard/security?domain=${encodeURIComponent(domain)}`}
            className="text-[#7DD3FC] hover:text-[#BAE6FD] underline"
          >
            /dashboard/security
          </Link>{" "}
          and start a domain verification for <code>{domain}</code> on{" "}
          <code>@{handle}</code>.
        </li>
        <li>
          Add a TXT record at <code>_oxp-challenge.{domain}</code> with the
          token shown there.
        </li>
        <li>
          Run the check (button on /dashboard/security or{" "}
          <code>oxp publisher verify --domain {domain}</code> from the CLI).
        </li>
        <li>
          Return to this page — the eligibility check re-evaluates on load and
          the &ldquo;Transfer&rdquo; button will appear.
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/dashboard/security?domain=${encodeURIComponent(domain)}`}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 transition"
        >
          <Globe className="w-3.5 h-3.5" />
          Open verification
        </Link>
        <Link
          href="/docs/signing-verification"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono auth-dim hover:text-[#7DD3FC]"
        >
          Docs
        </Link>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-container app-shell py-12">
      <div className="max-w-2xl">{children}</div>
    </div>
  );
}

function Row({
  ok,
  label,
  hint,
}: {
  ok: boolean;
  label: string;
  hint: string | null;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full ${
          ok
            ? "bg-emerald-400/15 text-emerald-300"
            : "bg-[#f8fafc]/10 text-[#f8fafc]/40"
        }`}
        aria-hidden
      >
        {ok ? (
          <ShieldCheck className="w-3 h-3" />
        ) : (
          <ShieldAlert className="w-3 h-3" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className={ok ? "auth-heading" : "auth-muted"}>{label}</p>
        {hint && <p className="text-xs font-mono auth-dim mt-1">{hint}</p>}
      </div>
    </li>
  );
}
