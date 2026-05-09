import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Sign a "this user authenticated via SSO" intent token. Only code that
 * holds NEXTAUTH_SECRET (i.e. our own server) can mint a valid value, so
 * the `sso-trusted` Credentials provider can safely accept a userId from
 * a server-side caller without re-checking a password. The token is bound
 * to a 5-minute window to prevent replay.
 */
const SSO_INTENT_TTL_MS = 5 * 60 * 1000;
function ssoIntentSecret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET / NEXTAUTH_SECRET required for SSO");
  return s;
}
export function mintSsoIntent(userId: string): string {
  const ts = Date.now().toString();
  const mac = createHmac("sha256", ssoIntentSecret())
    .update(`${userId}.${ts}`)
    .digest("hex");
  return `${userId}.${ts}.${mac}`;
}
function verifySsoIntent(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, ts, mac] = parts;
  const expected = createHmac("sha256", ssoIntentSecret())
    .update(`${userId}.${ts}`)
    .digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > SSO_INTENT_TTL_MS) return null;
  return userId;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      handle: string;
      displayName: string;
      avatarSeed: string;
      avatarUrl?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    handle: string;
    displayName: string;
    avatarSeed: string;
    avatarUrl?: string | null;
  }
}

/**
 * NextAuth v5 — Credentials provider + JWT session strategy.
 *
 * No database adapter: sessions live entirely in the signed JWT cookie.
 * The Credentials `authorize()` callback is the only DB read on sign-in.
 */
export const { auth, handlers, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = String(raw?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(raw?.password ?? "");

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // Email verification is required for credentials accounts.
        // GitHub OAuth signups set emailVerified at create time, so this
        // gate only ever fires for password-based accounts that haven't
        // clicked the verification link yet. The signin server action
        // catches this case before we get here and emits a friendly
        // "verify your email" message; throwing a generic AuthError here
        // is just defence-in-depth.
        if (!user.emailVerified) {
          throw new Error("EmailNotVerified");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          handle: user.handle,
          displayName: user.displayName,
          avatarSeed: user.avatarSeed,
          avatarUrl: user.avatarUrl,
        };
      },
    }),
    Credentials({
      id: "sso-trusted",
      name: "Single Sign-On",
      credentials: {
        intent: { label: "Intent", type: "text" },
      },
      async authorize(raw) {
        const intent = String(raw?.intent ?? "");
        if (!intent) return null;
        const userId = verifySsoIntent(intent);
        if (!userId) return null;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          handle: user.handle,
          displayName: user.displayName,
          avatarSeed: user.avatarSeed,
          avatarUrl: user.avatarUrl,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.uid = user.id as string;
        token.handle = (user as { handle: string }).handle;
        token.displayName = (user as { displayName: string }).displayName;
        token.avatarSeed = (user as { avatarSeed: string }).avatarSeed;
        token.avatarUrl =
          (user as { avatarUrl?: string | null }).avatarUrl ?? null;
      }
      // `update()` from the client can refresh denormalized fields without
      // forcing a full re-login (used after avatar / display-name edits).
      if (trigger === "update" && token.uid) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.uid as string },
          select: {
            displayName: true,
            avatarSeed: true,
            avatarUrl: true,
            handle: true,
          },
        });
        if (fresh) {
          token.handle = fresh.handle;
          token.displayName = fresh.displayName;
          token.avatarSeed = fresh.avatarSeed;
          token.avatarUrl = fresh.avatarUrl;
        }
        // Allow the caller to pass overrides via update({...}).
        if (session && typeof session === "object") {
          const s = session as Record<string, unknown>;
          if (typeof s.displayName === "string")
            token.displayName = s.displayName;
          if (typeof s.avatarUrl === "string" || s.avatarUrl === null)
            token.avatarUrl = s.avatarUrl as string | null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.uid as string;
        session.user.handle = token.handle as string;
        session.user.displayName = token.displayName as string;
        session.user.avatarSeed = token.avatarSeed as string;
        session.user.avatarUrl =
          (token.avatarUrl as string | null | undefined) ?? null;
      }
      return session;
    },
  },
});
