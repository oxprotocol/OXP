/**
 * POST /api/org/[handle]/sso/saml/acs
 *
 * SAML 2.0 Assertion Consumer Service. The IdP POSTs `SAMLResponse` and
 * `RelayState`. We base64-decode, verify signature against the configured
 * x509, extract the email, find-or-provision the User, mint an SSO intent
 * token, and redirect to /signin/sso for session completion.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySamlResponse, SsoError } from "@/lib/sso";
import { mintSsoIntent } from "@/auth";
import { findOrProvisionSsoUser } from "@/lib/sso-provision";

function appOrigin(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin.replace(/\/$/, "")
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const form = await req.formData();
  const samlResponse = String(form.get("SAMLResponse") ?? "");
  const relayState = String(form.get("RelayState") ?? "");
  if (!samlResponse)
    return NextResponse.json(
      { error: "missing SAMLResponse" },
      { status: 400 },
    );

  let next = "/dashboard";
  if (relayState) {
    try {
      const parsed = JSON.parse(
        Buffer.from(relayState, "base64url").toString(),
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
  if (!cfg || cfg.protocol !== "saml") {
    return NextResponse.json(
      { error: "SAML not configured for org" },
      { status: 404 },
    );
  }

  try {
    const assertion = verifySamlResponse(cfg, samlResponse);
    const email = assertion.email.toLowerCase();
    const displayName =
      assertion.attrs.displayname ??
      assertion.attrs.name ??
      email.split("@")[0];
    const user = await findOrProvisionSsoUser({
      orgId: org.id,
      email,
      displayName,
    });
    const intent = mintSsoIntent(user.id);
    const target = new URL(`${appOrigin(req)}/signin/sso`);
    target.searchParams.set("intent", intent);
    target.searchParams.set("next", next);
    return NextResponse.redirect(target.toString(), 302);
  } catch (e) {
    const err = e as SsoError | Error;
    console.error("[sso/saml/acs]", err);
    return NextResponse.json(
      { error: (err as SsoError).code ?? "saml_failed", message: err.message },
      { status: 400 },
    );
  }
}
