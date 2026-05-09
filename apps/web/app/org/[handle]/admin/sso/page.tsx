/**
 * SSO admin. Two protocols: OIDC and SAML. Form is client-side; reads
 * current config from the GET endpoint.
 */
import { loadOrgContextOrRedirect, requireTeamsPlus } from "@/lib/org-auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { SsoForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SsoAdmin({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const ctx = await loadOrgContextOrRedirect(handle);
  requireTeamsPlus(ctx);

  const cfg = await prisma.orgSsoConfig.findUnique({
    where: { orgId: ctx.org.id },
  });
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "";
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;

  const initial = cfg
    ? {
        protocol: cfg.protocol,
        issuer: cfg.issuer,
        ssoUrl: cfg.ssoUrl,
        clientId: cfg.clientId,
        emailAttr: cfg.emailAttr,
        enforced: cfg.enforced,
        hasSecret: Boolean(cfg.clientSecretEnc),
        x509Count: cfg.x509Certs
          ? cfg.x509Certs.split("BEGIN CERTIFICATE").length - 1
          : 0,
        enabledAt: cfg.enabledAt?.toISOString() ?? null,
      }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-mono text-sky-200">
      <h1 className="text-2xl tracking-[0.18em] uppercase mb-2">
        Single sign-on
      </h1>
      <p className="text-sm text-sky-300/60 mb-6">
        Configure SAML 2.0 or OIDC. New members sign in via{" "}
        <code className="text-sky-200">
          {origin}/api/org/{handle}/sso/start
        </code>{" "}
        — a User row is auto-provisioned and added to{" "}
        <span className="text-sky-200">@{handle}</span> as a contributor on
        first login.
      </p>
      <div className="hud-card p-4 mb-6 text-xs space-y-2">
        <p className="text-sky-300/60 tracking-[0.18em] uppercase text-[10px]">
          SP endpoints (give these to your IdP)
        </p>
        <code className="block text-sky-100 break-all">
          {origin}/api/org/{handle}/sso/saml/acs
        </code>
        <code className="block text-sky-100 break-all">
          {origin}/api/org/{handle}/sso/oidc/callback
        </code>
      </div>
      <SsoForm orgHandle={handle} initial={initial} />
    </main>
  );
}
