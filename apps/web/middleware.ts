/**
 * Phase 3 — custom-domain Host routing.
 *
 * When a request arrives on a hostname that an org has bound via
 * /org/<h>/admin/domain (and verified via DNS TXT), this middleware
 * rewrites unprefixed catalog URLs into the org's namespace so:
 *
 *   oxp.your-co.com/                  → /<your-co>
 *   oxp.your-co.com/cool-extension    → /<your-co>/cool-extension
 *   oxp.your-co.com/extension/v/1.0.0 → /<your-co>/extension/v/1.0.0
 *
 * Reserved top-level paths (/api, /dashboard, /signin, …) and platform
 * hosts (oxp.sh, *.vercel.app, localhost) pass through untouched.
 *
 * Runs on the Node.js runtime (stable since Next 15.2) so we can use
 * Prisma directly. Lookups are cached in-process by `lib/custom-domain`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isPlatformHost, resolveCustomDomain } from "@/lib/custom-domain";

export const config = {
  // Skip Next internals and static assets entirely. The negative lookahead
  // is the canonical "all routes except _next/static, _next/image, favicon"
  // matcher from the Next docs.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
  runtime: "nodejs",
};

/**
 * Top-level URL segments owned by the platform itself. These are always
 * served from the canonical app, never rewritten under an org handle.
 */
const RESERVED_SEGMENTS = new Set([
  "api",
  "dashboard",
  "signin",
  "signup",
  "logout",
  "settings",
  "pricing",
  "docs",
  "about",
  "legal",
  "terms",
  "privacy",
  "security",
  "status",
  "org",
  "publish",
  "search",
  "discover",
  "invite",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  if (!host || isPlatformHost(host)) {
    return NextResponse.next();
  }

  const handle = await resolveCustomDomain(host);
  if (!handle) {
    // Unknown / unverified domain. Return a tiny 421 ("Misdirected Request")
    // so the operator can tell their cert/CNAME wiring is correct but the
    // hostname isn't bound here yet.
    return new NextResponse(
      `OXP custom domain not configured for ${host}\n` +
        `Add it at /org/<your-handle>/admin/domain.\n`,
      {
        status: 421,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  const { pathname, search } = req.nextUrl;

  // Already addressed via the canonical /<handle>/... shape — pass through.
  if (pathname === `/${handle}` || pathname.startsWith(`/${handle}/`)) {
    return NextResponse.next({
      request: {
        headers: addCustomHostHeader(req.headers, host, handle),
      },
    });
  }

  const firstSeg = pathname.split("/", 2)[1] ?? "";

  // Reserved segments (api, dashboard, …) are never rewritten.
  if (RESERVED_SEGMENTS.has(firstSeg)) {
    return NextResponse.next({
      request: { headers: addCustomHostHeader(req.headers, host, handle) },
    });
  }

  // Root of the custom domain → org page.
  const target = pathname === "/" ? `/${handle}` : `/${handle}${pathname}`;
  const url = req.nextUrl.clone();
  url.pathname = target;
  url.search = search;

  return NextResponse.rewrite(url, {
    request: { headers: addCustomHostHeader(req.headers, host, handle) },
  });
}

/**
 * Stamp the request with custom-domain provenance so downstream route
 * handlers and server components can render canonical-host links when
 * needed (e.g. signed bundle URLs).
 */
function addCustomHostHeader(
  src: Headers,
  host: string,
  handle: string,
): Headers {
  const h = new Headers(src);
  h.set("x-oxp-custom-host", host);
  h.set("x-oxp-custom-host-handle", handle);
  return h;
}
