#!/usr/bin/env node
/**
 * scripts/sync-mcp.mjs
 *
 * Multi-source crawler that materialises every public MCP server we can find
 * into `lib/mcp-servers.json`. Sources (each best-effort, failures logged but
 * non-fatal so a single outage can never wipe the snapshot):
 *
 *   1. Official MCP registry API   - registry.modelcontextprotocol.io/v0/servers
 *   2. modelcontextprotocol/servers - GitHub repo, src/<name> directories
 *   3. npm registry                - keyword:mcp-server (and mcp keyword fallback)
 *   4. mcp.so public registry      - best-effort JSON endpoint
 *   5. glama.ai/mcp/servers        - best-effort JSON endpoint
 *
 * All entries are republished under the `@modelcontextprotocol` publisher
 * namespace so `oxp install @modelcontextprotocol/<slug>` is the single
 * universal install incantation. The original upstream publisher is preserved
 * on each record (`originalPublisher`) for attribution.
 *
 * A small set of curated overrides (the official 6 reference servers) keep
 * their hand-tuned `install` specs (Docker variants, required env vars, ...).
 *
 * Run automatically on a daily cron via `.github/workflows/sync-mcp.yml`.
 *
 * Env:
 *   MCP_REGISTRY_URL   override the official registry endpoint
 *   GITHUB_TOKEN       optional, lifts GitHub API rate limits
 *   MCP_SOURCES        comma-separated allow-list (registry,github,npm,mcpso,glama)
 */

import { writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "lib", "mcp-servers.json");

const REGISTRY_URL =
  process.env.MCP_REGISTRY_URL ||
  "https://registry.modelcontextprotocol.io/v0/servers";

const ENABLED = new Set(
  (process.env.MCP_SOURCES || "registry,github,npm,mcpso,glama")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const UA = "oxp-sync-mcp/2.0 (+https://oxp.sh)";

const FEATURED_SLUGS = new Set([
  "filesystem",
  "git",
  "github",
  "postgres",
  "fetch",
  "memory",
]);

// ─────────────────────────────────────────────────────────────────────────
// Curated overrides: the 6 reference servers ship with hand-tuned launchers
// (Docker variants, required env, helpful notes). Crawled metadata is merged
// over these last so descriptions etc. stay fresh, but `install` is locked.
// ─────────────────────────────────────────────────────────────────────────
const MANUAL_OVERRIDES = {
  filesystem: {
    name: "Filesystem",
    description:
      "Secure local filesystem access for MCP clients. Read, write, search, and watch files within sandboxed directories.",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    repository: "https://github.com/modelcontextprotocol/servers",
    transports: ["stdio"],
    tags: ["files", "official"],
    install: [
      {
        label: "npx (recommended)",
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "<ALLOWED_DIR>",
        ],
        notes:
          "Pass one or more absolute directory paths to expose to the model.",
      },
      {
        label: "Docker",
        command: "docker",
        args: [
          "run",
          "-i",
          "--rm",
          "--mount",
          "type=bind,src=<ALLOWED_DIR>,dst=/workspace",
          "mcp/filesystem",
          "/workspace",
        ],
      },
    ],
  },
  git: {
    name: "Git",
    description:
      "Inspect git history, diffs, branches, and blame from any MCP-aware agent without shelling out.",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    repository: "https://github.com/modelcontextprotocol/servers",
    transports: ["stdio"],
    tags: ["git", "official"],
    install: [
      {
        label: "uvx (recommended)",
        command: "uvx",
        args: ["mcp-server-git", "--repository", "<REPO_PATH>"],
        notes:
          "Requires `uv` (https://docs.astral.sh/uv) and a local clone of the repo.",
      },
    ],
  },
  github: {
    name: "GitHub",
    description:
      "Issues, pull requests, code search, and repo metadata over the GitHub API as MCP tools.",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    repository: "https://github.com/modelcontextprotocol/servers",
    transports: ["stdio", "http"],
    tags: ["github", "official"],
    install: [
      {
        label: "npx (recommended)",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "<your-token>" },
        notes:
          "Mint a token at https://github.com/settings/tokens with `repo` + `read:org` scopes.",
      },
    ],
  },
  postgres: {
    name: "Postgres",
    description:
      "Read-only SQL execution and schema introspection over a Postgres connection.",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    repository: "https://github.com/modelcontextprotocol/servers",
    transports: ["stdio"],
    tags: ["database", "sql", "official"],
    install: [
      {
        label: "npx (recommended)",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres", "<POSTGRES_URL>"],
        notes: "Example URL: postgresql://user:pass@localhost:5432/mydb",
      },
    ],
  },
  fetch: {
    name: "Fetch",
    description:
      "Fetch URLs and convert HTML to markdown so agents can read the live web.",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    repository: "https://github.com/modelcontextprotocol/servers",
    transports: ["stdio"],
    tags: ["web", "official"],
    install: [
      {
        label: "uvx (recommended)",
        command: "uvx",
        args: ["mcp-server-fetch"],
      },
    ],
  },
  memory: {
    name: "Memory",
    description:
      "Persistent knowledge-graph memory store for long-running agent sessions.",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    repository: "https://github.com/modelcontextprotocol/servers",
    transports: ["stdio"],
    tags: ["memory", "official"],
    install: [
      {
        label: "npx (recommended)",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        env: { MEMORY_FILE_PATH: "<absolute-path-to-memory.json>" },
      },
    ],
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/^@[^/]+\//, "") // drop npm scope
    .replace(/^mcp-server-/, "")
    .replace(/-mcp-server$/, "")
    .replace(/^server-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function pickArr(...vals) {
  for (const v of vals) {
    if (Array.isArray(v)) return v;
    if (v) return [v];
  }
  return [];
}

async function safeFetch(url, init = {}) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      console.warn(`[sync-mcp] ${url} -> ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[sync-mcp] ${url} failed: ${err.message}`);
    return null;
  }
}

// ─── source 1: official registry ─────────────────────────────────────────

async function crawlRegistry() {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const out = [];
  let cursor;

  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(REGISTRY_URL);
    u.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) u.searchParams.set("cursor", cursor);

    const body = await safeFetch(u.toString());
    if (!body) break;

    const items =
      body.servers ||
      body.items ||
      body.results ||
      body.data ||
      (Array.isArray(body) ? body : []);
    for (const raw of items) {
      const slug = slugify(raw.slug || raw.name || raw.id);
      if (!slug) continue;
      out.push({
        slug,
        name: raw.name || raw.displayName || raw.title || slug,
        description: (raw.description || raw.summary || "").trim(),
        homepage: raw.homepage || raw.website || raw.docs || undefined,
        repository: raw.repository?.url || raw.repository || raw.repoUrl,
        transports: pickArr(raw.transports, raw.transport)
          .map((t) => (typeof t === "string" ? t : t?.type))
          .filter(Boolean)
          .map((t) => String(t).toLowerCase()),
        tags: pickArr(raw.tags, raw.categories, raw.keywords)
          .filter(Boolean)
          .map((t) => String(t).toLowerCase()),
        originalPublisher:
          raw.publisher || raw.namespace || raw.owner || "community",
        source: "registry",
      });
    }

    cursor = body.next_cursor || body.nextCursor || body.metadata?.next_cursor;
    if (!cursor || items.length === 0) break;
  }

  return out;
}

// ─── source 2: github.com/modelcontextprotocol/servers ───────────────────

async function crawlOfficialRepo() {
  const ghHeaders = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const url =
    "https://api.github.com/repos/modelcontextprotocol/servers/contents/src";
  const body = await safeFetch(url, { headers: ghHeaders });
  if (!Array.isArray(body)) return [];

  return body
    .filter((entry) => entry.type === "dir")
    .map((entry) => {
      const slug = slugify(entry.name);
      return {
        slug,
        name: entry.name.replace(/\b\w/g, (c) => c.toUpperCase()),
        description: "",
        repository: "https://github.com/modelcontextprotocol/servers",
        homepage: `https://github.com/modelcontextprotocol/servers/tree/main/src/${entry.name}`,
        transports: ["stdio"],
        tags: ["official"],
        originalPublisher: "modelcontextprotocol",
        source: "github",
        // Best-effort install spec for npm-published reference servers.
        install: [
          {
            label: "npx",
            command: "npx",
            args: ["-y", `@modelcontextprotocol/server-${entry.name}`],
          },
        ],
      };
    });
}

// ─── source 3: npm registry (keyword search) ─────────────────────────────

async function crawlNpm() {
  const out = [];
  const seen = new Set();
  // Search by both common keywords; npm caps each query at 250 results.
  for (const q of ["keywords:mcp-server", "keywords:mcp"]) {
    let from = 0;
    for (let page = 0; page < 10; page++) {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=250&from=${from}`;
      const body = await safeFetch(url);
      const objs = body?.objects;
      if (!Array.isArray(objs) || objs.length === 0) break;
      for (const o of objs) {
        const pkg = o.package;
        if (!pkg?.name) continue;
        // Filter: must look like an MCP server, not a meta package.
        const looks =
          /mcp[-_]server|server[-_]mcp|^@[^/]+\/(mcp|server)/i.test(pkg.name) ||
          (pkg.keywords || []).some((k) => /mcp.?server/i.test(k));
        if (!looks) continue;
        if (seen.has(pkg.name)) continue;
        seen.add(pkg.name);

        const slug = slugify(pkg.name);
        if (!slug) continue;
        out.push({
          slug,
          name: (pkg.name.split("/").pop() || pkg.name)
            .replace(/^mcp-server-|^server-/, "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          description: (pkg.description || "").trim(),
          homepage: pkg.links?.homepage || pkg.links?.npm,
          repository: pkg.links?.repository,
          transports: ["stdio"],
          tags: ["npm", ...(pkg.keywords || []).slice(0, 4)],
          originalPublisher:
            (pkg.name.startsWith("@") && pkg.name.split("/")[0].slice(1)) ||
            pkg.publisher?.username ||
            "community",
          source: "npm",
          install: [
            {
              label: "npx",
              command: "npx",
              args: ["-y", pkg.name],
            },
          ],
        });
      }
      from += objs.length;
      if (objs.length < 250) break;
    }
  }
  return out;
}

// ─── source 4: mcp.so ────────────────────────────────────────────────────

async function crawlMcpSo() {
  // mcp.so doesn't publish a stable public schema; we try a couple of endpoints
  // and gracefully degrade if neither responds.
  const candidates = [
    "https://mcp.so/api/servers?limit=1000",
    "https://mcp.so/servers.json",
  ];
  for (const url of candidates) {
    const body = await safeFetch(url);
    if (!body) continue;
    const items = body.servers || body.data || body.results || body;
    if (!Array.isArray(items) || items.length === 0) continue;
    return items
      .map((raw) => {
        const slug = slugify(raw.slug || raw.name || raw.id);
        if (!slug) return null;
        return {
          slug,
          name: raw.name || raw.title || slug,
          description: (raw.description || raw.summary || "").trim(),
          homepage: raw.homepage || raw.website || raw.url,
          repository: raw.repository || raw.repo || raw.github,
          transports: pickArr(raw.transports, raw.transport).map((t) =>
            String(t).toLowerCase(),
          ),
          tags: pickArr(raw.tags, raw.categories).map((t) =>
            String(t).toLowerCase(),
          ),
          originalPublisher:
            raw.publisher || raw.author || raw.owner || "community",
          source: "mcp.so",
        };
      })
      .filter(Boolean);
  }
  return [];
}

// ─── source 5: glama.ai/mcp/servers ──────────────────────────────────────

async function crawlGlama() {
  const candidates = [
    "https://glama.ai/api/mcp/v1/servers?limit=1000",
    "https://glama.ai/mcp/servers.json",
  ];
  for (const url of candidates) {
    const body = await safeFetch(url);
    if (!body) continue;
    const items = body.servers || body.data || body.results || body;
    if (!Array.isArray(items) || items.length === 0) continue;
    return items
      .map((raw) => {
        const slug = slugify(raw.slug || raw.name || raw.id);
        if (!slug) return null;
        return {
          slug,
          name: raw.name || raw.title || slug,
          description: (raw.description || raw.summary || "").trim(),
          homepage: raw.homepage || raw.url,
          repository: raw.repository || raw.repositoryUrl,
          transports: pickArr(raw.transports).map((t) =>
            String(t).toLowerCase(),
          ),
          tags: pickArr(raw.tags, raw.categories).map((t) =>
            String(t).toLowerCase(),
          ),
          originalPublisher:
            raw.author || raw.owner || raw.publisher || "community",
          source: "glama",
        };
      })
      .filter(Boolean);
  }
  return [];
}

// ─── merge + emit ────────────────────────────────────────────────────────

/**
 * Merge multiple records for the same slug, preferring richer fields.
 */
function mergeRecord(a, b) {
  return {
    slug: a.slug,
    name: a.name?.length >= (b.name?.length || 0) ? a.name : b.name,
    description: (a.description || b.description || "").trim(),
    homepage: a.homepage || b.homepage,
    repository: a.repository || b.repository,
    transports: Array.from(
      new Set([...(a.transports || []), ...(b.transports || [])]),
    ),
    tags: Array.from(new Set([...(a.tags || []), ...(b.tags || [])])),
    originalPublisher: a.originalPublisher || b.originalPublisher,
    install: a.install || b.install,
    sources: Array.from(
      new Set(
        [
          ...(a.sources || (a.source ? [a.source] : [])),
          ...(b.sources || (b.source ? [b.source] : [])),
        ].filter(Boolean),
      ),
    ),
  };
}

async function main() {
  const runners = [
    ["registry", crawlRegistry],
    ["github", crawlOfficialRepo],
    ["npm", crawlNpm],
    ["mcpso", crawlMcpSo],
    ["glama", crawlGlama],
  ].filter(([id]) => ENABLED.has(id));

  console.log(
    `[sync-mcp] running sources: ${runners.map(([id]) => id).join(", ")}`,
  );

  const all = await Promise.all(
    runners.map(async ([id, fn]) => {
      try {
        const records = await fn();
        console.log(`[sync-mcp] ${id}: ${records.length} entries`);
        return records;
      } catch (err) {
        console.warn(`[sync-mcp] ${id} crashed: ${err.message}`);
        return [];
      }
    }),
  );

  // Dedupe by slug. If two sources produce the same slug from different upstream
  // publishers, deconflict by prefixing the second one with its publisher.
  const bySlug = new Map();
  for (const record of all.flat()) {
    if (!record?.slug) continue;
    const existing = bySlug.get(record.slug);
    if (!existing) {
      bySlug.set(record.slug, { ...record, sources: [record.source] });
      continue;
    }
    if (existing.originalPublisher === record.originalPublisher) {
      bySlug.set(record.slug, mergeRecord(existing, record));
    } else {
      const altSlug = slugify(`${record.originalPublisher}-${record.slug}`);
      if (altSlug && !bySlug.has(altSlug)) {
        bySlug.set(altSlug, {
          ...record,
          slug: altSlug,
          sources: [record.source],
        });
      }
    }
  }

  // Apply curated overrides + republish under @modelcontextprotocol.
  const PUBLISHER = "modelcontextprotocol";
  const servers = [];
  for (const rec of bySlug.values()) {
    const override = MANUAL_OVERRIDES[rec.slug];
    const merged = override
      ? { ...rec, ...override, sources: rec.sources }
      : rec;
    servers.push({
      id: `${PUBLISHER}/${merged.slug}`,
      name: merged.name,
      publisher: PUBLISHER,
      originalPublisher:
        merged.originalPublisher && merged.originalPublisher !== PUBLISHER
          ? merged.originalPublisher
          : undefined,
      description: merged.description || "",
      homepage: merged.homepage || undefined,
      repository: merged.repository || undefined,
      transports: merged.transports?.length ? merged.transports : ["stdio"],
      tags: merged.tags || [],
      featured: FEATURED_SLUGS.has(merged.slug) || undefined,
      install: merged.install || undefined,
      sources: merged.sources?.length ? merged.sources : undefined,
    });
  }

  // Backfill any curated server that no source returned (e.g. when running
  // offline with all crawlers blocked) so the snapshot never regresses.
  for (const slug of Object.keys(MANUAL_OVERRIDES)) {
    if (servers.find((s) => s.id === `${PUBLISHER}/${slug}`)) continue;
    const o = MANUAL_OVERRIDES[slug];
    servers.push({
      id: `${PUBLISHER}/${slug}`,
      name: o.name,
      publisher: PUBLISHER,
      description: o.description,
      homepage: o.homepage,
      repository: o.repository,
      transports: o.transports,
      tags: o.tags,
      featured: FEATURED_SLUGS.has(slug) || undefined,
      install: o.install,
    });
  }

  if (servers.length === 0) {
    throw new Error(
      "All sources returned zero servers - refusing to clobber the snapshot.",
    );
  }

  servers.sort((a, b) => {
    if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const snapshot = {
    syncedAt: new Date().toISOString(),
    source: "oxp-sync-mcp",
    sources: runners.map(([id]) => id),
    servers,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const tmp = `${OUT_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  await rename(tmp, OUT_PATH);

  console.log(`[sync-mcp] wrote ${servers.length} servers -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("[sync-mcp] FAILED:", err);
  process.exit(1);
});
