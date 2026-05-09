/**
 * GET /api/org/[handle]/sso/start
 *
 * Public endpoint. Begins SSO sign-in for the org's configured IdP.
 *  - OIDC: builds authorize URL with PKCE; sets `oxp_sso_pkce` + `oxp_sso_org`
 *    cookies; 302 to IdP.
 *  - SAML: builds AuthnRequest; renders auto-submit form to IdP's POST URL.
 *
 * `?next=/path` is preserved for post-login redirect (validated to a same-
 * origin path).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pkcePair, buildAuthnRequest, SsoError } from "@/lib/sso";

function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function appOrigin(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin.replace(/\/$/, "")
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const org = await prisma.organization.findUnique({
    where: { handle: handle.toLowerCase() },
  });
  if (!org) return NextResponse.json({ error: "unknown org" }, { status: 404 });
  const cfg = await prisma.orgSsoConfig.findUnique({
    where: { orgId: org.id },
  });
  if (!cfg)
    return NextResponse.json({ error: "SSO not configured" }, { status: 404 });

  const origin = appOrigin(req);

  if (cfg.protocol === "oidc") {
    const { verifier, challenge } = pkcePair();
    const redirectUri = `${origin}/api/org/${handle}/sso/oidc/callback`;
    const state = Buffer.from(JSON.stringify({ next, org: handle })).toString(
      "base64url",
    );
    const auth = new URL(cfg.ssoUrl);
    auth.searchParams.set("client_id", cfg.clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "openid profile email");
    auth.searchParams.set("state", state);
    auth.searchParams.set("code_challenge", challenge);
    auth.searchParams.set("code_challenge_method", "S256");
    const res = NextResponse.redirect(auth.toString(), 302);
    res.cookies.set("oxp_sso_pkce", verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return res;
  }

  if (cfg.protocol === "saml") {
    let request: string;
    try {
      request = buildAuthnRequest(
        cfg,
        `${origin}/api/org/${handle}/sso/saml/acs`,
      );
    } catch (e) {
      const err = e as SsoError;
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const relay = Buffer.from(JSON.stringify({ next, org: handle })).toString(
      "base64url",
    );
    // Auto-submit form. Browsers will POST immediately on load.
    const html = `<!doctype html><html><body onload="document.forms[0].submit()">
<noscript>JavaScript is required for SSO.</noscript>
<form method="POST" action="${escapeAttr(cfg.ssoUrl)}">
<input type="hidden" name="SAMLRequest" value="${escapeAttr(request)}" />
<input type="hidden" name="RelayState" value="${escapeAttr(relay)}" />
<button type="submit">Continue to identity provider</button>
</form></body></html>`;
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.json({ error: "unknown protocol" }, { status: 500 });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
