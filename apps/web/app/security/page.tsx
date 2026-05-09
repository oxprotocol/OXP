/**
 * Public security policy + vulnerability disclosure page. Linked from /trust
 * and from the public footer. Anchors (#secrets, #sandbox, #signing) are
 * referenced from /trust controls table — keep their ids stable.
 */

import Link from "next/link";

export const metadata = { title: "Security · OXP" };

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-mono text-sky-200">
      <p className="text-xs tracking-[0.2em] text-sky-300/50 uppercase">
        / security
      </p>
      <h1 className="text-3xl tracking-[0.18em] uppercase mt-2 mb-3">
        Security &amp; disclosure
      </h1>
      <p className="text-xs tracking-[0.2em] uppercase text-sky-300/40 mb-8">
        Last updated 25 May 2026
      </p>

      <p className="text-sm text-sky-300/70 leading-relaxed mb-10">
        Security is OXP&apos;s #1 design priority. The full living threat model
        lives in{" "}
        <a
          className="text-cyan-300"
          href="https://github.com/oxprotocol/oxp/blob/main/SECURITY.md"
          target="_blank"
          rel="noreferrer"
        >
          SECURITY.md
        </a>
        . This page summarises the controls referenced from{" "}
        <Link className="text-cyan-300" href="/trust">
          /trust
        </Link>{" "}
        and tells you how to report a vulnerability.
      </p>

      <section id="disclosure" className="hud-card p-5 mb-6 scroll-mt-24">
        <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100 mb-3">
          Reporting a vulnerability
        </h2>
        <p className="text-sm text-sky-200/80 leading-relaxed mb-3">
          Email{" "}
          <a className="text-cyan-300" href="mailto:security@oxp.sh">
            security@oxp.sh
          </a>{" "}
          with reproduction steps and the affected version. We acknowledge
          within 2 business days, ship a fix or mitigation within 30 days for
          high-severity issues, and credit reporters in the release notes unless
          you ask us not to. Please do not file a public GitHub issue for
          security reports.
        </p>
        <p className="text-xs text-sky-300/60">
          Out of scope: rate-limit findings without impact, missing security
          headers on marketing pages, attacks requiring physical access.
        </p>
      </section>

      <section id="sandbox" className="hud-card p-5 mb-6 scroll-mt-24">
        <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100 mb-3">
          WASM sandbox
        </h2>
        <p className="text-sm text-sky-200/80 leading-relaxed">
          Untrusted extension code runs as a WASI Preview 2 component with no
          preopens, no env, and no network. Every host capability is mediated by
          a typed broker — a bundle cannot fabricate a syscall it did not
          declare in its WIT imports. Permissions are granted at install time
          via an explicit prompt, persisted per (publisher, slug), and
          re-prompted when an upgrade adds a new capability.
        </p>
      </section>

      <section id="signing" className="hud-card p-5 mb-6 scroll-mt-24">
        <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100 mb-3">
          Signed bundles &amp; TOFU pinning
        </h2>
        <p className="text-sm text-sky-200/80 leading-relaxed">
          Every <code className="text-cyan-300">.oxp</code> bundle is signed
          with Ed25519 at pack time. Hosts re-verify the signature locally
          before install — the registry is treated as untrusted transport. The
          first key seen for a publisher is pinned (TOFU); upgrades signed with
          a different key are rejected until the publisher rotates through the
          signed key-rotation flow.
        </p>
      </section>

      <section id="secrets" className="hud-card p-5 mb-6 scroll-mt-24">
        <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100 mb-3">
          Secrets at rest &amp; in transit
        </h2>
        <p className="text-sm text-sky-200/80 leading-relaxed">
          SSO credentials, storage keys, and KMS material are envelope-encrypted
          with AES-256-GCM under a server-held master key before being
          persisted. Edge proxies enforce TLS 1.2 minimum with HSTS preload on{" "}
          <code className="text-cyan-300">oxp.sh</code>. Per-extension storage
          is namespaced with the prefix{" "}
          <code className="text-cyan-300">
            oxp:storage:&lt;extensionId&gt;:
          </code>{" "}
          so two components cannot read each other&apos;s keys.
        </p>
      </section>

      <section id="tokens" className="hud-card p-5 mb-6 scroll-mt-24">
        <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100 mb-3">
          Publish tokens &amp; 2FA
        </h2>
        <p className="text-sm text-sky-200/80 leading-relaxed">
          Publish tokens are scoped (
          <code className="text-cyan-300">publish:@handle/*</code> or
          per-package), default to a 90-day TTL, and can be rotated with a
          5-minute hand-over grace. Accounts with TOTP 2FA enrolled must present
          a recent (≤ 10 min) factor before any publish; recovery codes are
          bcrypt-hashed and single-use. Manage tokens at{" "}
          <Link className="text-cyan-300" href="/dashboard/tokens">
            /dashboard/tokens
          </Link>{" "}
          and 2FA at{" "}
          <Link className="text-cyan-300" href="/dashboard/security">
            /dashboard/security
          </Link>
          .
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
