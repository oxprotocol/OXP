/**
 * Phase B.8 — programmatic NextAuth session creation.
 *
 * Lets server route handlers (specifically the GitHub OAuth callback in
 * "auth" mode) sign a user in WITHOUT going through the Credentials
 * provider's email+password authorize() path. We mint the same JWT and
 * write the same cookie that NextAuth would have set.
 *
 * Keep this file in sync with the JWT shape produced by
 * `auth.ts → callbacks.jwt` — specifically the `uid`, `handle`,
 * `displayName`, `avatarSeed` claims that `callbacks.session` reads.
 */

import { encode } from "next-auth/jwt";
import { cookies } from "next/headers";

/**
 * NextAuth v5 cookie name. In production with HTTPS, the prefix becomes
 * `__Secure-`. We also use the same value as the encode `salt`.
 */
function cookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // match NextAuth default

export interface MintParams {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  avatarSeed: string;
}

/**
 * Sign a user in by writing the NextAuth session cookie ourselves.
 * Returns once the cookie has been set on the outgoing response.
 */
export async function setSessionCookie(user: MintParams): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET not configured");

  const name = cookieName();
  const token = await encode({
    token: {
      sub: user.id,
      uid: user.id,
      email: user.email,
      name: user.displayName,
      handle: user.handle,
      displayName: user.displayName,
      avatarSeed: user.avatarSeed,
    },
    secret,
    salt: name,
    maxAge: MAX_AGE_SECONDS,
  });

  const jar = await cookies();
  jar.set(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
