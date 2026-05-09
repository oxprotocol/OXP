// Phase B.2 — Reserved namespace list (brand protection).
//
// This is the *brand* reserved list — distinct from `RESERVED_HANDLES` in
// `owners.ts`, which protects route segments (`/api`, `/admin`, `/docs`…).
//
// Brand-reserved handles are blocked at signup unless the registrant has
// completed publisher verification (Phase B.1) for the matching domain.
// Until B.1 ships, the list is hard-blocked and operators must mint these
// accounts via DB seed (see `prisma/seed.ts`) for the genuine owner.
//
// Sources used to assemble the list:
//   - Top 100 SaaS / DX vendors developers commonly impersonate
//   - Big-tech orgs whose absence from a registry would be conspicuous
//   - Payment / identity providers (high blast radius if squatted)
//   - AI labs (current attack surface)
//
// When adding a brand: include the canonical lowercase handle plus any
// hyphen-separated variants the regex `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`
// would normalise to. Do NOT include obvious typos — registrar UIs should
// surface "did you mean @microsoft?" rather than reserving every variant.

export interface ReservedBrand {
  handle: string;
  /** Canonical apex domain used for B.1 TXT verification. */
  domain: string;
  category:
    | "big-tech"
    | "ai-lab"
    | "payments"
    | "devtools"
    | "infra"
    | "ide"
    | "oxp-internal";
}

export const RESERVED_BRANDS: ReservedBrand[] = [
  // OXP-internal (also covered structurally by route reservations, but
  // listed here so the error message is consistent).
  { handle: "oxp", domain: "oxp.sh", category: "oxp-internal" },
  { handle: "oxp-core", domain: "oxp.sh", category: "oxp-internal" },
  { handle: "oxp-themes", domain: "oxp.sh", category: "oxp-internal" },
  { handle: "oxprotocol", domain: "oxp.sh", category: "oxp-internal" },

  // Big tech
  { handle: "microsoft", domain: "microsoft.com", category: "big-tech" },
  { handle: "google", domain: "google.com", category: "big-tech" },
  { handle: "apple", domain: "apple.com", category: "big-tech" },
  { handle: "amazon", domain: "amazon.com", category: "big-tech" },
  { handle: "aws", domain: "aws.amazon.com", category: "big-tech" },
  { handle: "meta", domain: "meta.com", category: "big-tech" },
  { handle: "facebook", domain: "facebook.com", category: "big-tech" },
  { handle: "github", domain: "github.com", category: "big-tech" },
  { handle: "gitlab", domain: "gitlab.com", category: "big-tech" },
  { handle: "ibm", domain: "ibm.com", category: "big-tech" },
  { handle: "oracle", domain: "oracle.com", category: "big-tech" },
  { handle: "intel", domain: "intel.com", category: "big-tech" },
  { handle: "nvidia", domain: "nvidia.com", category: "big-tech" },

  // AI labs
  { handle: "openai", domain: "openai.com", category: "ai-lab" },
  { handle: "anthropic", domain: "anthropic.com", category: "ai-lab" },
  { handle: "deepmind", domain: "deepmind.google", category: "ai-lab" },
  { handle: "mistral", domain: "mistral.ai", category: "ai-lab" },
  { handle: "huggingface", domain: "huggingface.co", category: "ai-lab" },
  { handle: "cohere", domain: "cohere.com", category: "ai-lab" },
  { handle: "perplexity", domain: "perplexity.ai", category: "ai-lab" },
  { handle: "xai", domain: "x.ai", category: "ai-lab" },

  // Payments / identity
  { handle: "stripe", domain: "stripe.com", category: "payments" },
  { handle: "paypal", domain: "paypal.com", category: "payments" },
  { handle: "square", domain: "squareup.com", category: "payments" },
  { handle: "plaid", domain: "plaid.com", category: "payments" },
  { handle: "auth0", domain: "auth0.com", category: "payments" },
  { handle: "okta", domain: "okta.com", category: "payments" },
  { handle: "clerk", domain: "clerk.com", category: "payments" },

  // Devtools
  { handle: "vercel", domain: "vercel.com", category: "devtools" },
  { handle: "netlify", domain: "netlify.com", category: "devtools" },
  { handle: "supabase", domain: "supabase.com", category: "devtools" },
  { handle: "planetscale", domain: "planetscale.com", category: "devtools" },
  { handle: "neon", domain: "neon.tech", category: "devtools" },
  { handle: "linear", domain: "linear.app", category: "devtools" },
  { handle: "sentry", domain: "sentry.io", category: "devtools" },
  { handle: "datadog", domain: "datadoghq.com", category: "devtools" },
  { handle: "newrelic", domain: "newrelic.com", category: "devtools" },
  { handle: "pagerduty", domain: "pagerduty.com", category: "devtools" },
  { handle: "tailwindlabs", domain: "tailwindcss.com", category: "devtools" },
  { handle: "shadcn", domain: "shadcn.com", category: "devtools" },
  { handle: "prisma", domain: "prisma.io", category: "devtools" },
  { handle: "drizzle", domain: "drizzle.team", category: "devtools" },
  { handle: "trpc", domain: "trpc.io", category: "devtools" },

  // Infra
  { handle: "cloudflare", domain: "cloudflare.com", category: "infra" },
  { handle: "fastly", domain: "fastly.com", category: "infra" },
  { handle: "digitalocean", domain: "digitalocean.com", category: "infra" },
  { handle: "linode", domain: "linode.com", category: "infra" },
  { handle: "heroku", domain: "heroku.com", category: "infra" },
  { handle: "render", domain: "render.com", category: "infra" },
  { handle: "fly", domain: "fly.io", category: "infra" },
  { handle: "railway", domain: "railway.app", category: "infra" },
  { handle: "redis", domain: "redis.io", category: "infra" },
  { handle: "mongodb", domain: "mongodb.com", category: "infra" },
  { handle: "postgres", domain: "postgresql.org", category: "infra" },
  { handle: "postgresql", domain: "postgresql.org", category: "infra" },

  // IDE / editor vendors
  { handle: "vscode", domain: "code.visualstudio.com", category: "ide" },
  { handle: "jetbrains", domain: "jetbrains.com", category: "ide" },
  { handle: "neovim", domain: "neovim.io", category: "ide" },
  { handle: "vim", domain: "vim.org", category: "ide" },
  { handle: "emacs", domain: "gnu.org", category: "ide" },
  { handle: "sublimetext", domain: "sublimetext.com", category: "ide" },
  { handle: "zed", domain: "zed.dev", category: "ide" },
  { handle: "cursor", domain: "cursor.sh", category: "ide" },
  { handle: "windsurf", domain: "codeium.com", category: "ide" },
  { handle: "codeium", domain: "codeium.com", category: "ide" },
  { handle: "copilot", domain: "github.com", category: "ide" },
];

const RESERVED_BRAND_MAP = new Map(RESERVED_BRANDS.map((b) => [b.handle, b]));

export function findReservedBrand(handle: string): ReservedBrand | undefined {
  return RESERVED_BRAND_MAP.get(handle.toLowerCase());
}

export function isReservedBrand(handle: string): boolean {
  return RESERVED_BRAND_MAP.has(handle.toLowerCase());
}
