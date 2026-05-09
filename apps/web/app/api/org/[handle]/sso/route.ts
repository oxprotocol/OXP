/**
 * SSO config CRUD for an org. Teams+ only.
 *
 * GET  → current config (secrets masked)
 * PUT  → set OIDC config { protocol:"oidc", issuer, clientId, clientSecret, emailAttr? }
 *        or SAML config  { protocol:"saml", metadataXml, emailAttr? }
 *        We auto-discover OIDC endpoints and parse SAML metadata server-side.
 * DELETE
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOrgContext, requireTeamsPlus, OrgAuthError } from "@/lib/org-auth";
import { discoverOidc, parseSamlMetadata, SsoError } from "@/lib/sso";
import { encryptSecret, maskSecret } from "@/lib/crypto-envelope";
import { recordAudit } from "@/lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireTeamsPlus(ctx);
    const row = await prisma.orgSsoConfig.findUnique({
      where: { orgId: ctx.org.id },
    });
    if (!row) return NextResponse.json({ sso: null });
    return NextResponse.json({
      sso: {
        protocol: row.protocol,
        issuer: row.issuer,
        ssoUrl: row.ssoUrl,
        clientId: row.clientId,
        clientSecretMask: row.clientSecretEnc ? "•••••••• (set)" : "",
        tokenUrl: row.tokenUrl,
        userinfoUrl: row.userinfoUrl,
        emailAttr: row.emailAttr,
        x509Count: row.x509Certs
          ? row.x509Certs.split("BEGIN CERTIFICATE").length - 1
          : 0,
        enforced: row.enforced,
        enabledAt: row.enabledAt,
        loginUrl: `/api/org/${ctx.org.handle}/sso/start`,
        spAcsUrl: `/api/org/${ctx.org.handle}/sso/saml/acs`,
        spOidcRedirectUrl: `/api/org/${ctx.org.handle}/sso/oidc/callback`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireTeamsPlus(ctx);
    const body = (await req.json()) as Record<string, unknown>;
    const protocol = String(body.protocol ?? "");
    const emailAttr = String(body.emailAttr ?? "email").toLowerCase();
    const enforced = Boolean(body.enforced);

    if (protocol === "oidc") {
      const issuer = String(body.issuer ?? "").trim();
      const clientId = String(body.clientId ?? "").trim();
      const clientSecret = String(body.clientSecret ?? "");
      if (!issuer || !clientId) {
        return NextResponse.json(
          { error: "issuer and clientId required" },
          { status: 400 },
        );
      }
      let disc;
      try {
        disc = await discoverOidc(issuer);
      } catch (e) {
        const err = e as SsoError;
        return NextResponse.json(
          { error: `OIDC discovery failed: ${err.message}` },
          { status: 400 },
        );
      }
      const existing = await prisma.orgSsoConfig.findUnique({
        where: { orgId: ctx.org.id },
      });
      const clientSecretEnc = clientSecret
        ? encryptSecret(clientSecret)
        : (existing?.clientSecretEnc ?? "");
      const row = await prisma.orgSsoConfig.upsert({
        where: { orgId: ctx.org.id },
        create: {
          orgId: ctx.org.id,
          protocol: "oidc",
          issuer: disc.issuer,
          ssoUrl: disc.authorization_endpoint,
          tokenUrl: disc.token_endpoint,
          userinfoUrl: disc.userinfo_endpoint ?? "",
          clientId,
          clientSecretEnc,
          x509Certs: "",
          emailAttr,
          enforced,
        },
        update: {
          protocol: "oidc",
          issuer: disc.issuer,
          ssoUrl: disc.authorization_endpoint,
          tokenUrl: disc.token_endpoint,
          userinfoUrl: disc.userinfo_endpoint ?? "",
          clientId,
          clientSecretEnc,
          x509Certs: "",
          emailAttr,
          enforced,
        },
      });
      await recordAudit({
        action: "sso.config",
        target: ctx.org.handle,
        actorUserId: ctx.user.id,
        orgId: ctx.org.id,
        metadata: { protocol: "oidc", issuer: disc.issuer, enforced },
      });
      return NextResponse.json({ ok: true, id: row.id });
    }

    if (protocol === "saml") {
      const metadataXml = String(body.metadataXml ?? "").trim();
      if (!metadataXml.includes("<")) {
        return NextResponse.json(
          { error: "metadataXml is required (paste IdP metadata XML)" },
          { status: 400 },
        );
      }
      let meta;
      try {
        meta = parseSamlMetadata(metadataXml);
      } catch (e) {
        const err = e as SsoError;
        return NextResponse.json(
          { error: `SAML metadata invalid: ${err.message}` },
          { status: 400 },
        );
      }
      const row = await prisma.orgSsoConfig.upsert({
        where: { orgId: ctx.org.id },
        create: {
          orgId: ctx.org.id,
          protocol: "saml",
          issuer: meta.entityId,
          ssoUrl: meta.ssoUrl,
          x509Certs: meta.x509Certs,
          clientId: "",
          clientSecretEnc: "",
          tokenUrl: "",
          userinfoUrl: "",
          emailAttr,
          enforced,
        },
        update: {
          protocol: "saml",
          issuer: meta.entityId,
          ssoUrl: meta.ssoUrl,
          x509Certs: meta.x509Certs,
          clientId: "",
          clientSecretEnc: "",
          tokenUrl: "",
          userinfoUrl: "",
          emailAttr,
          enforced,
        },
      });
      await recordAudit({
        action: "sso.config",
        target: ctx.org.handle,
        actorUserId: ctx.user.id,
        orgId: ctx.org.id,
        metadata: { protocol: "saml", issuer: meta.entityId, enforced },
      });
      return NextResponse.json({ ok: true, id: row.id });
    }

    return NextResponse.json(
      { error: 'protocol must be "oidc" or "saml"' },
      { status: 400 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireTeamsPlus(ctx);
    const before = await prisma.orgSsoConfig.findUnique({
      where: { orgId: ctx.org.id },
      select: { protocol: true },
    });
    await prisma.orgSsoConfig.deleteMany({ where: { orgId: ctx.org.id } });
    if (before) {
      await recordAudit({
        action: "sso.config",
        target: ctx.org.handle,
        actorUserId: ctx.user.id,
        orgId: ctx.org.id,
        metadata: { protocol: before.protocol, removed: true },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown): Response {
  const err = e as OrgAuthError;
  if (err && typeof err.status === "number") {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[org/sso]", e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

// keep import-side-effect typecheck happy
void maskSecret;
