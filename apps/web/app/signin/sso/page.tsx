/**
 * SSO finalize page. Reached after /api/org/.../sso/{oidc/callback,saml/acs}
 * verifies the assertion and mints an HMAC-bound `intent` token.
 *
 * We render an auto-submitting form that POSTs the intent into the
 * `sso-trusted` Auth.js Credentials provider via /api/auth/callback/sso-trusted.
 * Auth.js issues the JWT cookie and redirects to `next`.
 *
 * Done as a form POST (not server-side `signIn()`) because Auth.js v5's
 * `signIn` server action requires a CSRF token round-trip the user-facing
 * provider already knows how to do — so we hand off here.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ intent?: string; next?: string }>;
}

export default async function SsoFinalize({ searchParams }: Props) {
  const sp = await searchParams;
  const intent = sp.intent ?? "";
  const next =
    sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//")
      ? sp.next
      : "/dashboard";
  if (!intent) redirect("/signin");

  // Build CSRF-protected POST. Auth.js exposes a CSRF token at
  // /api/auth/csrf which the form must include.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "";
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
  const csrfRes = await fetch(`${origin}/api/auth/csrf`, { cache: "no-store" });
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  return (
    <html>
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#000",
          color: "#7DD3FC",
          fontFamily: "monospace",
        }}
      >
        <noscript>
          <p style={{ padding: "2rem" }}>
            JavaScript is required to complete sign-in.
          </p>
        </noscript>
        <form
          method="POST"
          action="/api/auth/callback/sso-trusted"
          style={{ display: "none" }}
          id="sso-finalize"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="callbackUrl" value={next} />
          <input type="hidden" name="redirect" value="true" />
        </form>
        <p style={{ padding: "2rem" }}>Completing sign-in…</p>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.getElementById('sso-finalize').submit();`,
          }}
        />
      </body>
    </html>
  );
}
