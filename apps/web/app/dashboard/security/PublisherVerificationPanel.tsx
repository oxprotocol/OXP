import Link from "next/link";
import { BadgeCheck, ShieldCheck, ShieldAlert, Code2 } from "lucide-react";
import type { PublisherTrust } from "@/lib/publisher-level";
import { findReservedBrand } from "@/lib/reserved-handles";
import {
  DomainVerificationWizard,
  type PendingVerification,
  type VerifiedVerification,
} from "./DomainVerificationWizard";

const VERIFY_MESSAGES: Record<
  string,
  { tone: "ok" | "warn" | "err"; text: string }
> = {
  github_success: {
    tone: "ok",
    text: "GitHub verified — your handle is now Level 2 (GitHub).",
  },
  github_mismatch: {
    tone: "warn",
    text: "GitHub login does not match your OXP handle. We did not grant verification.",
  },
  github_state_invalid: {
    tone: "err",
    text: "Verification link expired or tampered. Please retry.",
  },
  github_state_expired: {
    tone: "err",
    text: "Verification link expired. Please retry within 10 minutes.",
  },
  github_session_changed: {
    tone: "err",
    text: "Your session changed mid-flow. Please retry while signed in.",
  },
  github_exchange_failed: {
    tone: "err",
    text: "GitHub rejected the authorization. Please retry.",
  },
  github_profile_unavailable: {
    tone: "err",
    text: "Could not read your GitHub profile. Please retry.",
  },
  github_already_linked: {
    tone: "err",
    text: "That GitHub account is already linked to a different OXP user.",
  },
  github_unconfigured: {
    tone: "err",
    text: "GitHub OAuth is not configured on this server.",
  },
  github_error: {
    tone: "err",
    text: "GitHub returned an error during authorization.",
  },
};

export function PublisherVerificationPanel({
  handle,
  trust,
  status,
  statusActual,
  pendingDomains,
  verifiedDomains,
  defaultDomain,
}: {
  handle: string;
  trust: PublisherTrust;
  status?: string;
  statusActual?: string;
  pendingDomains: PendingVerification[];
  verifiedDomains: VerifiedVerification[];
  defaultDomain?: string;
}) {
  const message = status ? VERIFY_MESSAGES[status] : null;
  const githubReady = !trust.githubLogin || trust.level === "unverified";
  const brand = findReservedBrand(handle);

  return (
    <section className="auth-card rounded-md border border-(--auth-card-br) bg-(--auth-card-bg) p-6 mt-8">
      <header className="flex items-start gap-4 mb-6">
        <div className="auth-icon-tile p-3 rounded inline-flex">
          <BadgeCheck className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="auth-heading text-xl font-bold mb-1">
            Publisher verification
          </h2>
          <p className="auth-muted text-xs font-mono leading-relaxed max-w-2xl">
            Verified publishers earn a trust badge across the registry. Two
            tiers: <span className="text-sky-400">Level 2 — GitHub</span> (your
            GitHub login matches <code className="font-mono">@{handle}</code>)
            and <span className="text-emerald-400">Level 3 — Domain</span> (you
            control a DNS record on your apex domain).
          </p>
        </div>
        <CurrentLevelChip level={trust.level} />
      </header>

      {message && (
        <div
          className={`mb-6 rounded border px-4 py-3 text-xs font-mono ${
            message.tone === "ok"
              ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-300"
              : message.tone === "warn"
                ? "border-[#7DD3FC]/30 bg-[#7DD3FC]/8 text-[#BAE6FD]"
                : "border-red-400/30 bg-red-400/5 text-red-300"
          }`}
        >
          {message.text}
          {status === "github_mismatch" && statusActual && (
            <div className="mt-2 opacity-80">
              expected <code>@{handle}</code> · received{" "}
              <code>@{statusActual}</code>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Level 2 — GitHub */}
        <div className="rounded border border-sky-400/20 bg-sky-400/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <h3 className="auth-heading text-sm font-bold">Level 2 · GitHub</h3>
            {trust.githubLogin &&
              trust.githubLogin === handle.toLowerCase() && (
                <span className="ml-auto text-xs font-mono text-emerald-400">
                  ✓ verified
                </span>
              )}
          </div>
          <p className="auth-muted text-xs font-mono mb-4 leading-relaxed">
            Sign in with GitHub. We grant this tier when the GitHub{" "}
            <code>login</code> exactly matches your OXP handle.
          </p>
          {trust.githubLogin && trust.githubLogin === handle.toLowerCase() ? (
            <div className="text-xs font-mono auth-dim">
              Linked: <span className="auth-accent">@{trust.githubLogin}</span>
            </div>
          ) : (
            <a
              href="/api/verify/github/start"
              className="inline-flex items-center gap-2 rounded border border-sky-400/40 bg-sky-400/10 px-3 py-1.5 text-xs font-mono text-sky-300 hover:bg-sky-400/20"
            >
              <Code2 className="w-3.5 h-3.5" />
              {githubReady ? "Verify with GitHub" : "Re-verify GitHub"}
            </a>
          )}
        </div>

        {/* Level 3 — Domain */}
        <div className="rounded border border-emerald-400/20 bg-emerald-400/5 p-4 sm:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <BadgeCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="auth-heading text-sm font-bold">Level 3 · Domain</h3>
            {trust.domain && (
              <span className="ml-auto text-xs font-mono text-emerald-400">
                ✓ {trust.domain}
              </span>
            )}
          </div>
          <p className="auth-muted text-xs font-mono mb-4 leading-relaxed">
            Prove you control a DNS record on your apex domain. Required for
            reserved-brand handles and to claim a brand-prefixed VSX listing.
            You can also drive this from the CLI:{" "}
            <code>oxp publisher verify --domain example.com</code>.
          </p>
          <DomainVerificationWizard
            handle={handle}
            reserved={!!brand}
            reservedDomain={brand?.domain ?? null}
            pending={pendingDomains}
            verified={verifiedDomains}
            defaultDomain={defaultDomain}
          />
        </div>
      </div>

      {trust.reserved && (
        <div className="mt-6 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/8 px-4 py-3 text-xs font-mono text-[#BAE6FD] flex gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Reserved-brand handle.</strong> <code>@{handle}</code> can
            only be claimed by proving DNS ownership of{" "}
            <code>{brand?.domain ?? "the brand domain"}</code>. GitHub
            verification alone is not enough — use the Level 3 panel above.
          </div>
        </div>
      )}
    </section>
  );
}

function CurrentLevelChip({ level }: { level: PublisherTrust["level"] }) {
  if (level === "domain")
    return (
      <span className="rounded bg-emerald-400/10 px-2 py-1 text-xs font-mono text-emerald-300 ring-1 ring-emerald-400/30">
        Level 3 · Domain
      </span>
    );
  if (level === "github")
    return (
      <span className="rounded bg-sky-400/10 px-2 py-1 text-xs font-mono text-sky-300 ring-1 ring-sky-400/30">
        Level 2 · GitHub
      </span>
    );
  return (
    <span className="rounded bg-white/5 px-2 py-1 text-xs font-mono auth-dim ring-1 ring-white/10">
      Level 1 · Unverified
    </span>
  );
}
