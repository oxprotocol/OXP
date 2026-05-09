/**
 * GET /api/org/[handle]/sso/oidc/callback?code=...&state=...
 *
 * Public endpoint. Exchanges code → tokens, fetches userinfo, finds-or-
 * provisions a User row bound to this org, then mints an SSO intent token
 * and redirects to /signin/sso?intent=... where Auth.js completes the
 * session via the `sso-trusted` Credentials provider.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeOidcCode, fetchOidcUserinfo, SsoError } from "@/lib/sso";
import { mintSsoIntent } from "@/auth";
import { findOrProvisionSsoUser } from "@/lib/sso-provision";

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
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code)
    return NextResponse.json({ error: "missing code" }, { status: 400 });

  let next = "/dashboard";
  if (stateRaw) {
    try {
      const parsed = JSON.parse(
        Buffer.from(stateRaw, "base64url").toString(),
      ) as { next?: string };
      if (
        parsed.next &&
        parsed.next.startsWith("/") &&
        !parsed.next.startsWith("//")
      ) {
        next = parsed.next;
      }
    } catch {
      /* ignore */
    }
  }

  const org = await prisma.organization.findUnique({
    where: { handle: handle.toLowerCase() },
  });
  if (!org) return NextResponse.json({ error: "unknown org" }, { status: 404 });
  const cfg = await prisma.orgSsoConfig.findUnique({
    where: { orgId: org.id },
  });
  if (!cfg || cfg.protocol !== "oidc") {
    return NextResponse.json(
      { error: "OIDC not configured for org" },
      { status: 404 },
    );
  }

  const verifier = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("oxp_sso_pkce="))
    ?.slice("oxp_sso_pkce=".length);
  if (!verifier) {
    return NextResponse.json(
      { error: "missing PKCE cookie (start over)" },
      { status: 400 },
    );
  }

  try {
    const tokens = await exchangeOidcCode(
      cfg,
      `${appOrigin(req)}/api/org/${handle}/sso/oidc/callback`,
      code,
      verifier,
    );
    const profile = await fetchOidcUserinfo(cfg, tokens.access_token);
    const email = String(
      profile[cfg.emailAttr] ?? profile.email ?? "",
    ).toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: `userinfo missing ${cfg.emailAttr}` },
        { status: 400 },
      );
    }
    const displayName = String(
      profile.name ?? profile.preferred_username ?? email.split("@")[0],
    );
    const user = await findOrProvisionSsoUser({
      orgId: org.id,
      email,
      displayName,
    });
    const intent = mintSsoIntent(user.id);
    const target = new URL(`${appOrigin(req)}/signin/sso`);
    target.searchParams.set("intent", intent);
    target.searchParams.set("next", next);
    const res = NextResponse.redirect(target.toString(), 302);
    res.cookies.set("oxp_sso_pkce", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    const err = e as SsoError | Error;
    console.error("[sso/oidc/callback]", err);
    return NextResponse.json(
      {
        error: (err as SsoError).code ?? "exchange_failed",
        message: err.message,
      },
      { status: 400 },
    );
  }
}
