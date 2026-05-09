/**
 * GET /api/verify/github/start?mode=verify|auth&next=/dashboard
 *
 * Two modes share one OAuth dance:
 *  - `verify` (default): user must be signed in. Adds a Level-2 GitHub
 *    proof to their existing handle.
 *  - `auth`: anonymous-friendly. Used by the Sign in / Sign up "Continue
 *    with GitHub" buttons. The callback finds-or-creates a user and sets
 *    a NextAuth session cookie directly.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import {
  authorizeUrl,
  makeStatePayload,
  readOauthEnv,
  signState,
  STATE_COOKIE_NAME,
  type OauthMode,
} from "@/lib/github-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://oxp.sh").replace(
  /\/$/,
  "",
);

function safeNext(raw: string | null): string {
  // Reject open-redirects: only allow same-origin paths.
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawMode = url.searchParams.get("mode");
  const mode: OauthMode = rawMode === "auth" ? "auth" : "verify";
  const next = safeNext(url.searchParams.get("next"));

  const env = readOauthEnv();
  if (!env) {
    return NextResponse.json(
      { error: "github oauth not configured on server" },
      { status: 503 },
    );
  }

  const me = await getCurrentUser();

  // verify mode: must be signed in
  if (mode === "verify" && !me) {
    return NextResponse.redirect(
      new URL("/signin?next=/api/verify/github/start", APP_URL),
    );
  }
  // auth mode: if already signed in, just take them to next
  if (mode === "auth" && me) {
    return NextResponse.redirect(new URL(next, APP_URL));
  }

  const payload = makeStatePayload(me?.id ?? "", mode, next);
  const state = signState(payload, env.authSecret);

  const jar = await cookies();
  jar.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/verify/github",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(env, state));
}
