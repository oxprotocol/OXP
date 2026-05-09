/**
 * GET /api/verify/github/callback?code&state
 *
 * GitHub redirects here after the user authorizes our OAuth app. The
 * state cookie's `mode` decides what happens next:
 *
 *   verify → user is signed in. Match login==handle → upsert
 *            PublisherVerification(github_oauth) and recompute level.
 *   auth   → anonymous-friendly. Find user by githubId → reuse; else by
 *            verified email → link; else create handle=githubLogin and
 *            auto-verify Level 2. Then set NextAuth session cookie.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  exchangeCode,
  fetchGithubUser,
  fetchPrimaryEmail,
  readOauthEnv,
  STATE_COOKIE_NAME,
  verifyState,
  type GithubUser,
} from "@/lib/github-oauth";
import { recomputePublisherLevel } from "@/lib/publisher-level";
import { findReservedBrand } from "@/lib/reserved-handles";
import { RESERVED_HANDLES } from "@/lib/owners";
import { ensureFreeSubscription } from "@/lib/billing";
import { setSessionCookie } from "@/lib/session-mint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://oxp.sh").replace(
  /\/$/,
  "",
);

function dashRedirect(query: string): Response {
  return NextResponse.redirect(`${APP_URL}/dashboard/security?${query}`);
}

function signinRedirect(query: string): Response {
  return NextResponse.redirect(`${APP_URL}/signin?${query}`);
}

function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE_NAME)?.value;
  // Always burn the cookie — single-use.
  jar.delete({ name: STATE_COOKIE_NAME, path: "/api/verify/github" });

  if (oauthError) {
    return dashRedirect(
      `verify=github_error&reason=${encodeURIComponent(oauthError)}`,
    );
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return dashRedirect("verify=github_state_invalid");
  }

  const env = readOauthEnv();
  if (!env) return dashRedirect("verify=github_unconfigured");

  const payload = verifyState(state, env.authSecret);
  if (!payload) return dashRedirect("verify=github_state_expired");

  const exchange = await exchangeCode(env, code);
  if ("error" in exchange) {
    return dashRedirect(
      `verify=github_exchange_failed&reason=${encodeURIComponent(exchange.error)}`,
    );
  }

  const gh = await fetchGithubUser(exchange.accessToken);
  if (!gh) return dashRedirect("verify=github_profile_unavailable");

  if (payload.mode === "auth") {
    return handleAuthMode(gh, exchange.accessToken, payload.next);
  }
  return handleVerifyMode(gh, payload.userId);
}

// ── verify mode ────────────────────────────────────────────────────────

async function handleVerifyMode(
  gh: GithubUser,
  expectedUserId: string,
): Promise<Response> {
  const me = await getCurrentUser();
  if (!me || me.id !== expectedUserId) {
    return dashRedirect("verify=github_session_changed");
  }

  const ghLogin = gh.login.toLowerCase();
  const ghId = String(gh.id);
  const handle = me.handle.toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { githubId: ghId, NOT: { id: me.id } },
    select: { handle: true },
  });
  if (existing) {
    return dashRedirect(
      `verify=github_already_linked&owner=${encodeURIComponent(existing.handle)}`,
    );
  }

  if (ghLogin !== handle) {
    await prisma.user.update({
      where: { id: me.id },
      data: { githubId: ghId, githubLogin: ghLogin },
    });
    return dashRedirect(
      `verify=github_mismatch&expected=${encodeURIComponent(handle)}&actual=${encodeURIComponent(ghLogin)}`,
    );
  }

  await persistVerification(handle, ghLogin, ghId, me.id);
  await recomputePublisherLevel(handle);
  return dashRedirect("verify=github_success");
}

// ── auth mode (sign-in / sign-up) ──────────────────────────────────────

async function handleAuthMode(
  gh: GithubUser,
  accessToken: string,
  rawNext: string | undefined,
): Promise<Response> {
  const next = safeNext(rawNext);
  const ghLogin = gh.login.toLowerCase();
  const ghId = String(gh.id);

  // 1. Existing user with this GitHub identity → straight sign-in.
  const byGithubId = await prisma.user.findUnique({
    where: { githubId: ghId },
  });
  if (byGithubId) {
    await setSessionCookie({
      id: byGithubId.id,
      email: byGithubId.email,
      handle: byGithubId.handle,
      displayName: byGithubId.displayName,
      avatarSeed: byGithubId.avatarSeed,
    });
    return NextResponse.redirect(`${APP_URL}${next}`);
  }

  // 2. Try to link by verified primary email.
  const email = await fetchPrimaryEmail(accessToken);
  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      // Refuse to silently link if that user already has a different
      // GitHub linked — would be a footgun for shared mailboxes.
      if (byEmail.githubId && byEmail.githubId !== ghId) {
        return signinRedirect(
          `error=${encodeURIComponent("That email is already linked to a different GitHub account.")}`,
        );
      }
      await prisma.user.update({
        where: { id: byEmail.id },
        data: { githubId: ghId, githubLogin: ghLogin },
      });
      // Auto-verify if the GitHub login matches the OXP handle.
      if (byEmail.handle.toLowerCase() === ghLogin) {
        await persistVerification(byEmail.handle, ghLogin, ghId, byEmail.id);
        await recomputePublisherLevel(byEmail.handle);
      }
      await setSessionCookie({
        id: byEmail.id,
        email: byEmail.email,
        handle: byEmail.handle,
        displayName: byEmail.displayName,
        avatarSeed: byEmail.avatarSeed,
      });
      return NextResponse.redirect(`${APP_URL}${next}`);
    }
  }

  // 3. Create a new account from the GitHub profile.
  if (!email) {
    return signinRedirect(
      `error=${encodeURIComponent("GitHub did not return a verified email. Set a primary verified email and try again.")}`,
    );
  }

  // Reject reserved handles — these need Level-3 domain proof.
  if (RESERVED_HANDLES.has(ghLogin)) {
    return signinRedirect(
      `error=${encodeURIComponent(`@${ghLogin} is reserved. Sign up with a different account.`)}`,
    );
  }
  const brand = findReservedBrand(ghLogin);
  if (brand) {
    return signinRedirect(
      `error=${encodeURIComponent(`@${ghLogin} is reserved for ${brand.domain}.`)}`,
    );
  }

  // Handle taken? Bail with a friendly hint.
  const taken = await prisma.user.findUnique({ where: { handle: ghLogin } });
  if (taken) {
    return signinRedirect(
      `error=${encodeURIComponent(`Handle @${ghLogin} is already taken on OXP. Sign in with that account or create one with a different handle.`)}`,
    );
  }

  const displayName = gh.name?.trim() || gh.login;
  const avatarSeed =
    displayName
      .split(/\s+/)
      .map((s) => s[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || ghLogin.slice(0, 2).toUpperCase();

  // Sentinel passwordHash: bcrypt can never match, so /api/v1/auth/login
  // and Credentials.authorize() both refuse password sign-in for this
  // account. The user signs in via GitHub only (or sets a password later
  // through a future "set password" flow).
  const passwordHash = `github-only:${randomBytes(32).toString("base64url")}`;

  const created = await prisma.user.create({
    data: {
      handle: ghLogin,
      email,
      displayName,
      avatarSeed,
      passwordHash,
      githubId: ghId,
      githubLogin: ghLogin,
      emailVerified: new Date(),
    },
  });

  // Free plan by default. Paid upgrades flow through Paddle webhooks.
  await ensureFreeSubscription(created.id);

  // Brand new account whose handle == github login → auto Level 2.
  await persistVerification(ghLogin, ghLogin, ghId, created.id);
  await recomputePublisherLevel(ghLogin);

  await setSessionCookie({
    id: created.id,
    email: created.email,
    handle: created.handle,
    displayName: created.displayName,
    avatarSeed: created.avatarSeed,
  });
  return NextResponse.redirect(
    `${APP_URL}${next}?welcome=github&handle=${encodeURIComponent(ghLogin)}`,
  );
}

// ── shared helpers ─────────────────────────────────────────────────────

async function persistVerification(
  handle: string,
  ghLogin: string,
  ghId: string,
  userId: string,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const token = randomBytes(32).toString("base64url");

  await prisma.$transaction([
    prisma.publisherVerification.upsert({
      where: {
        handle_method_target: {
          handle,
          method: "github_oauth",
          target: ghLogin,
        },
      },
      create: {
        handle,
        method: "github_oauth",
        target: ghLogin,
        token,
        status: "verified",
        createdByUserId: userId,
        verifiedAt: now,
        expiresAt,
      },
      update: {
        status: "verified",
        verifiedAt: now,
        revokedAt: null,
        expiresAt,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { githubId: ghId, githubLogin: ghLogin },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: "publisher.verified",
        subject: `user:${userId}`,
        metadata: { method: "github_oauth", handle, githubLogin: ghLogin },
      },
    }),
  ]);
}
