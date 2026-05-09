# Vercel Deployment — Pre-flight Checklist

This document captures **everything needed before clicking Deploy** on Vercel.
**Do not deploy yet.** Work through these steps first.

---

## 1. Project import settings

When importing the GitHub repo into Vercel, use:

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** |
| Root Directory | `apps/web` |
| Build Command | *(leave default — uses `package.json` "build")* |
| Install Command | `pnpm install --frozen-lockfile` |
| Output Directory | *(leave default — `.next`)* |
| Node.js Version | **22.x** (Next 16 requirement) |

Because this is a pnpm workspace monorepo, Vercel needs to install from the
**repo root** but build from `apps/web`. Vercel auto-detects this when you set
Root Directory = `apps/web` and the lockfile is at the root.

`prisma generate` runs automatically via the new `postinstall` hook in
`apps/web/package.json` (added 2025-… in this prep).

---

## 2. Environment variables

Set these in Vercel → Project → Settings → Environment Variables.
Mark each for **Production** (and **Preview** if you want preview URLs to
work end-to-end — recommended for everything except Paddle live keys).

### App
| Key | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://oxp.sh` | No trailing slash |
| `AUTH_SECRET` | *(generate: `openssl rand -base64 32`)* | NextAuth JWT signing |
| `AUTH_URL` | `https://oxp.sh` | Optional with v5 but safe to set |
| `AUTH_TRUST_HOST` | `true` | Required behind Vercel proxy |

### Database (Neon)
| Key | Value |
|---|---|
| `NEON_DATABASE_URL` | pooled connection string (`?sslmode=require&pgbouncer=true`) |
| `NEON_DIRECT_URL` | direct connection string (for migrations) |
| `DATABASE_URL` | same as `NEON_DATABASE_URL` (some libs read this name) |

### OAuth
| Key | Value |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | from GitHub OAuth App pointed at `https://oxp.sh/api/auth/callback/github` |
| `GITHUB_OAUTH_CLIENT_SECRET` | from same app |
| `GITHUB_TOKEN` | server-side GitHub PAT for repo metadata calls |

### Paddle (Billing) — **production**
| Key | Value | Format |
|---|---|---|
| `PADDLE_API_KEY` | live secret | starts `pdl_live_apikey_…` |
| `PADDLE_ENV` | `production` | |
| `PADDLE_PRICE_PRO_MONTHLY` | **`pri_…`** | ⚠ **NOT** `pro_…` (that's product id) |
| `PADDLE_PRICE_TEAMS_MONTHLY` | **`pri_…`** | ⚠ same |
| `PADDLE_WEBHOOK_SECRET` | from Paddle → Notifications → Webhooks → Secret key | required for subscription activation |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | live client-side token | `live_…` |

After deploy, update Paddle webhook URL to:
`https://oxp.sh/api/billing/webhook`

### Postmark (Email)
| Key | Value |
|---|---|
| `POSTMARK_TOKEN` | server token from Postmark server settings |
| `POSTMARK_FROM_NOREPLY` | `OXP <noreply@oxp.sh>` |
| `POSTMARK_FROM_SUPPORT` | `OXP Support <support@oxp.sh>` |
| `POSTMARK_REPLY_TO` | `support@oxp.sh` |
| `POSTMARK_MESSAGE_STREAM` | `outbound` |

### Storage / Misc
| Key | Notes |
|---|---|
| `S3_ENDPOINT` | (only if using object storage features) |
| `MCP_REGISTRY_URL` | (optional) |
| `NEXT_PUBLIC_DISCORD_GUILD_ID` | (optional, for community link) |
| `NEXT_PUBLIC_DISCORD_INVITE_URL` | (optional) |
| `NEXT_PUBLIC_GITHUB_ORG` | `aldgar` |

### Do NOT set
- `STRIPE_SECRET_KEY` — Paddle is the active provider; remove leftover.
- `.env.local` — Vercel ignores it; use the dashboard.

---

## 3. Database migration strategy

**Production uses `prisma migrate deploy`, not `db push`.**

Before first deploy:

```bash
# locally, with NEON_DIRECT_URL pointed at production
pnpm --filter @oxprotocol/web prisma migrate deploy
```

Or set up a Vercel "Build Command" override to:
```
prisma migrate deploy && prisma generate && next build --webpack
```
(but keep schema migrations out of build if you want zero-downtime; prefer
running `migrate deploy` from CI or locally before promoting a deploy).

---

## 4. DNS — required for email + custom domain

### Domain pointed at Vercel
- `A` `@` → `76.76.21.21` (Vercel)
- `CNAME` `www` → `cname.vercel-dns.com`

### Email authentication (Postmark) — see `lib/email.ts`
1. **DKIM** TXT record from Postmark dashboard (selector e.g. `20240101pm._domainkey.oxp.sh`)
2. **Return-Path** CNAME `pm-bounces.oxp.sh` → `pm.mtasv.net` (HUGE deliverability win)
3. **SPF** TXT on root: `v=spf1 include:spf.mtasv.net ~all`
4. **DMARC** TXT `_dmarc.oxp.sh`: `v=DMARC1; p=none; rua=mailto:dmarc@oxp.sh; pct=100; adkim=s; aspf=s`

All three (DKIM + Return-Path + SPF) must show ✅ green in Postmark **before** the first production email is sent, otherwise users will see them in spam.

---

## 5. Build verified locally ✅

`pnpm --filter @oxprotocol/web build` passes as of this prep:
- Next.js 16.2.4 with webpack
- All routes compile
- TypeScript clean
- Prisma client regenerates via `postinstall`

**Pre-existing non-blocking lint warnings** (Tailwind v4 modernization, can be fixed later):
- `flex-shrink-0` → `shrink-0`
- `min-w-[720px]` → `min-w-180`

Note: Next 16 emits `The "middleware" file convention is deprecated. Please use "proxy" instead.` — non-blocking, but plan a follow-up to rename `middleware.ts` → `proxy.ts`.

---

## 6. Post-deploy smoke checklist

After first prod deploy, click through:

- [ ] Homepage loads, no console errors
- [ ] `/signup` → email verification arrives in **inbox** (not spam) — confirms DKIM/SPF/DMARC
- [ ] `/signin` works with GitHub OAuth (callback URL updated in GitHub OAuth App)
- [ ] `/pricing` → "Get started" goes to `/signup` ✅
- [ ] `/api/billing/checkout?plan=pro` opens Paddle checkout (or returns 503 with hint if `pri_` env is wrong)
- [ ] Complete a £1 test purchase (or use Paddle sandbox first if possible)
- [ ] Paddle webhook hits `https://oxp.sh/api/billing/webhook` → user shows as Pro on `/dashboard/billing`
- [ ] `/dashboard?upgraded=pro` shows the cyan success banner

---

## 7. Outstanding user-side items 🔒

- [ ] **Revoke leaked npm token** (the one accidentally pasted in chat earlier this session) at https://www.npmjs.com/settings/aldgar/tokens
- [ ] Fix `PADDLE_PRICE_*` env vars to use `pri_…` ids (currently `pro_…`)
- [ ] Fill `PADDLE_WEBHOOK_SECRET` in `.env.local` and Vercel
- [ ] Set up DKIM + Return-Path + SPF + DMARC in DNS (see §4)
- [ ] Optionally switch npm 2FA to "Authorization only" mode for less friction on future publishes

---

## 8. Recommended `vercel.json` (optional)

Vercel auto-detects everything correctly without a `vercel.json`. Add one only if you need to override:

```json
{
  "buildCommand": "pnpm --filter @oxprotocol/web build",
  "installCommand": "pnpm install --frozen-lockfile",
  "framework": "nextjs"
}
```

Place at `apps/web/vercel.json` if used.
