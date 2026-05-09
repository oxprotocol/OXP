/**
 * GitHub OAuth verification (Phase B.8) — server helpers.
 *
 * This is **identity verification**, not login. The user is already
 * authenticated via Credentials; we use GitHub OAuth purely to prove
 * "the person controlling @<handle> on OXP also controls
 * github.com/<handle>".
 *
 * Flow:
 *   1. Browser hits /api/verify/github/start → we sign a state token
 *      (JWT-ish, HMAC-SHA256) carrying `userId` + `nonce`, set as a
 *      short-lived httpOnly cookie, and redirect to GitHub.
 *   2. GitHub bounces back to /api/verify/github/callback?code&state.
 *   3. We verify the state cookie matches, exchange the code for an
 *      access token, fetch /user, compare login (case-insensitive) to
 *      the OXP handle. If it matches → upsert a `github_oauth`
 *      verification row with status=verified and recompute the level.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_COOKIE = "oxp_gh_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
// `read:user` for profile (login + id), `user:email` for primary verified
// email so the auth flow can link/seed accounts.
const SCOPE = "read:user user:email";

export const STATE_COOKIE_NAME = STATE_COOKIE;

export interface OauthEnv {
  clientId: string;
  clientSecret: string;
  appUrl: string;
  authSecret: string;
}

export function readOauthEnv(): OauthEnv | null {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";
  const authSecret = process.env.AUTH_SECRET;
  if (!clientId || !clientSecret || !authSecret) return null;
  return { clientId, clientSecret, appUrl, authSecret };
}

export function callbackUrl(env: OauthEnv): string {
  return `${env.appUrl}/api/verify/github/callback`;
}

// ─── State token (HMAC-signed, no third-party dep) ──────────────────────

/**
 * `mode` distinguishes the two reuse-cases of the same OAuth dance:
 *  - "verify": user is already signed in; we add a Level-2 proof to their
 *    existing handle.
 *  - "auth": user is anonymous; we either sign them in (existing githubId
 *    or matching email) or create a fresh account whose handle == github
 *    login (auto-Level-2).
 */
export type OauthMode = "verify" | "auth";

interface StatePayload {
  userId: string; // "" when mode === "auth" and there's no logged-in user
  nonce: string;
  exp: number; // epoch ms
  mode: OauthMode;
  next?: string; // post-redirect target for auth mode
}

export function signState(payload: StatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(
  token: string,
  secret: string,
): StatePayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  if (typeof payload.userId !== "string" || typeof payload.nonce !== "string")
    return null;
  if (payload.mode !== "verify" && payload.mode !== "auth") return null;
  return payload;
}

export function makeStatePayload(
  userId: string,
  mode: OauthMode = "verify",
  next?: string,
): StatePayload {
  return {
    userId,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + STATE_TTL_MS,
    mode,
    next,
  };
}

// ─── GitHub HTTP ─────────────────────────────────────────────────────────

export function authorizeUrl(env: OauthEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: callbackUrl(env),
    scope: SCOPE,
    state,
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(
  env: OauthEnv,
  code: string,
): Promise<{ accessToken: string } | { error: string }> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      code,
      redirect_uri: callbackUrl(env),
    }),
  });
  if (!res.ok) return { error: `github token exchange ${res.status}` };
  const j = (await res.json()) as {
    access_token?: string;
    error_description?: string;
  };
  if (!j.access_token) {
    return { error: j.error_description || "no access token" };
  }
  return { accessToken: j.access_token };
}

export interface GithubUser {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
}

export async function fetchGithubUser(
  accessToken: string,
): Promise<GithubUser | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "oxp.sh verify/1.0",
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as GithubUser;
}

/**
 * Fetch the user's primary verified email. The /user endpoint sometimes
 * returns null for `email` when the user marked it private, so we always
 * read /user/emails and pick the primary+verified one. Requires the
 * `user:email` scope.
 */
export async function fetchPrimaryEmail(
  accessToken: string,
): Promise<string | null> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "oxp.sh verify/1.0",
    },
  });
  if (!res.ok) return null;
  const emails = (await res.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  const primary = emails.find((e) => e.primary && e.verified);
  return primary?.email?.toLowerCase() ?? null;
}
