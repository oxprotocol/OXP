#!/usr/bin/env node
// Import top extensions from Open VSX into our registry.
//
// Default mode is DRY-RUN: prints the transformed shape to stdout and writes
// the full set to /tmp/openvsx-top-<N>.json. No DB writes. Pass --commit to
// actually upsert into Postgres (NOT IMPLEMENTED YET — review the dump first).
//
// Usage:
//   node scripts/import-openvsx.mjs                  # dry-run, top 200
//   node scripts/import-openvsx.mjs --size=50        # dry-run, top 50
//   node scripts/import-openvsx.mjs --commit         # write to DB (TODO)

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const SIZE = Number.parseInt(args.size ?? "200", 10);
const COMMIT = !!args.commit;
const CONCURRENCY = Number.parseInt(args.concurrency ?? "8", 10);
const SEARCH_URL = `https://open-vsx.org/api/-/search?size=${SIZE}&sortBy=downloadCount&sortOrder=desc`;

/** Sleep for n ms. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "oxp-importer/0.1" },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`${res.status} ${url}`);
    await sleep(500 * 2 ** attempt);
    return fetchJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Run an async mapper with limited concurrency. */
async function pmap(items, fn, limit) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx], idx);
        } catch (err) {
          out[idx] = { __error: String(err?.message ?? err) };
        }
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** Slugify "Foo Bar" -> "foo-bar" (a-z0-9- only, max 63). */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * Mirror of lib/github-identity.ts#parseGithubOrg — kept inline so this
 * .mjs script has no TS build dependency. Update both when changing.
 */
function parseGithubOrg(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("git+")) s = s.slice(4);
  if (s.startsWith("github:")) s = "https://github.com/" + s.slice(7);
  if (s.startsWith("git@github.com:")) {
    s = "https://github.com/" + s.slice("git@github.com:".length);
  }
  if (s.startsWith("ssh://")) {
    s = s.replace(/^ssh:\/\/(?:git@)?/, "https://");
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }
  const segs = url.pathname.split("/").filter(Boolean);
  if (!segs.length) return null;
  const owner = segs[0].toLowerCase().replace(/\.git$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner)) return null;
  const RESERVED = new Set([
    "orgs",
    "settings",
    "marketplace",
    "topics",
    "trending",
    "explore",
    "notifications",
    "pulls",
    "issues",
    "search",
    "login",
    "join",
    "logout",
    "new",
    "about",
    "pricing",
    "features",
    "enterprise",
    "sponsors",
  ]);
  if (RESERVED.has(owner)) return null;
  return owner;
}

/** Build the OXP-side record shape for one Open VSX extension. */
function toOxpRecord(meta) {
  // meta is the response of /api/{namespace}/{name} (full extension detail)
  const namespace = meta.namespace;
  const name = meta.name;
  const slug = slugify(name);
  const ownerHandle = `vsx-${slugify(namespace)}`;

  // Repository URL can be string or {url}.
  const repo =
    typeof meta.repository === "string"
      ? meta.repository
      : (meta.repository?.url ?? null);
  const sourceGithubOrg = parseGithubOrg(repo);

  // Categories from VS Code marketplace ("Programming Languages", "Themes", …).
  const tags = Array.isArray(meta.categories)
    ? meta.categories
        .map((c) => slugify(c))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  // Engines/IDE compat — Open VSX does not expose engines.vscode directly in
  // the meta response, so we infer "works in" from the fact that it ships as
  // a .vsix (universally compatible with VS Code-flavoured IDEs).
  const worksIn = ["vscode", "cursor", "windsurf", "vscodium"];

  // Generate the synthetic oxp.json manifest we'd serve for this extension.
  const oxpManifest = {
    schema: "https://oxp.sh/schema/manifest/v1.json",
    name: `@${ownerHandle}/${slug}`,
    version: meta.version,
    title: meta.displayName || name,
    description: meta.description ?? "",
    author: namespace,
    license: meta.license ?? null,
    repository: repo,
    homepage: meta.homepage ?? null,
    bugs: meta.bugs ?? null,
    icon: meta.files?.icon ?? null,
    tags,
    // We mark the source so the host can route to the VSX install adapter.
    source: {
      kind: "vsx-mirror",
      registry: "open-vsx",
      namespace,
      name,
      version: meta.version,
      vsixUrl: meta.files?.download ?? null,
      sha256Url: meta.files?.sha256 ?? null,
    },
    capabilities: {
      // VSX-mirrored extensions do not run inside the OXP wasm sandbox; they
      // delegate to the IDE's own extension host. Mark explicitly.
      runtime: "host-native",
    },
    worksIn,
  };

  return {
    // -- Extension row (lib/types.ts shape) ------------------------------------
    extension: {
      ownerHandle,
      ownerKind: "user", // synthetic VSX namespace owner; we'll pre-create it
      ownerId: null, // set during commit (mapped to seeded synthetic User row)
      slug,
      title: meta.displayName || name,
      description: meta.description ?? "",
      visibility: "public",
      status: "vsx-compatible", // <-- new status, NOT "planned"
      availability: "available",
      tags,
      latestVersion: meta.version,
      downloads: meta.downloadCount ?? 0,
      stars: 0,
      repositoryUrl: repo,
      sourceGithubOrg,
      iconUrl: meta.files?.icon ?? null,
      worksIn,
      vsx: {
        namespace,
        name,
        averageRating: meta.averageRating ?? null,
        reviewCount: meta.reviewCount ?? 0,
        verified: !!meta.verified,
        timestamp: meta.timestamp ?? null,
      },
    },
    // -- Synthetic v1 release row ---------------------------------------------
    version: {
      version: meta.version,
      manifestJson: oxpManifest,
      publishedAt: meta.timestamp ?? null,
      vsixUrl: meta.files?.download ?? null,
      sha256Url: meta.files?.sha256 ?? null,
    },
  };
}

async function main() {
  console.error(`[oxp:import] fetching top ${SIZE} from Open VSX…`);
  const search = await fetchJson(SEARCH_URL);
  console.error(
    `[oxp:import] got ${search.extensions.length} of ${search.totalSize} total VSX extensions`,
  );

  console.error(
    `[oxp:import] hydrating package metadata (concurrency=${CONCURRENCY})…`,
  );
  const records = await pmap(
    search.extensions,
    async (ext) => {
      const detail = await fetchJson(
        `https://open-vsx.org/api/${ext.namespace}/${ext.name}`,
      );
      return toOxpRecord(detail);
    },
    CONCURRENCY,
  );

  const ok = records.filter((r) => r && !r.__error);
  const failed = records.filter((r) => r && r.__error);
  console.error(
    `[oxp:import] hydrated ${ok.length} ok, ${failed.length} failed`,
  );

  const outPath = path.join(tmpdir(), `openvsx-top-${SIZE}.json`);
  await writeFile(outPath, JSON.stringify(ok, null, 2));
  console.error(`[oxp:import] wrote full dump → ${outPath}`);

  // Print a compact preview to stdout so the human can eyeball the shape.
  const preview = ok.slice(0, 3);
  console.log(JSON.stringify(preview, null, 2));

  if (COMMIT) {
    await commitToDb(ok);
  }
}

// ─── DB commit ───────────────────────────────────────────────────────────────

async function commitToDb(records) {
  // Lazy-load Prisma so dry-run mode doesn't need the client.
  const { PrismaClient } =
    await import("../node_modules/@prisma/client/index.js");
  const prisma = new PrismaClient();

  // Group by namespace so we create one synthetic user per VSX publisher.
  const byNs = new Map();
  for (const r of records) {
    const ns = r.extension.vsx.namespace;
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns).push(r);
  }

  console.error(
    `[oxp:import] committing ${records.length} extensions across ${byNs.size} namespaces…`,
  );

  let usersUpserted = 0;
  let extsUpserted = 0;

  for (const [ns, group] of byNs) {
    const ownerHandle = `vsx-${slugify(ns)}`;
    // Synthetic placeholder user. passwordHash is a random unguessable string
    // (no one can sign in as this account — claim flow will rebind it later).
    const user = await prisma.user.upsert({
      where: { handle: ownerHandle },
      update: {},
      create: {
        handle: ownerHandle,
        email: `noreply+${ownerHandle}@oxp.sh`,
        emailVerified: null,
        passwordHash: `vsx-claimable:${crypto.randomUUID()}:${crypto.randomUUID()}`,
        displayName: ns,
        avatarSeed: ownerHandle,
        bio: `Mirrored from Open VSX namespace "${ns}". This is an unclaimed placeholder — the original publisher can claim it.`,
      },
    });
    usersUpserted++;

    for (const r of group) {
      const ext = r.extension;
      const tags = Array.from(
        new Set(["vsx-compatible", "oxp-native-planned", ...(ext.tags ?? [])]),
      ).slice(0, 12);

      // Stash VSX-specific fields in readme as fenced JSON so the detail page
      // can parse it without a schema migration.
      const readme = [
        `# ${ext.title}`,
        ``,
        ext.description,
        ``,
        `> **VSX Compatible** — mirrored from [Open VSX](https://open-vsx.org/extension/${ns}/${ext.vsx.name}).`,
        `> **OXP Native: Planned** — original author can claim and ship a native build.`,
        ``,
        `\`\`\`json oxp-vsx-meta`,
        JSON.stringify(
          {
            source: "open-vsx",
            namespace: ns,
            name: ext.vsx.name,
            version: ext.latestVersion,
            iconUrl: ext.iconUrl,
            vsixUrl: r.version.vsixUrl,
            worksIn: ext.worksIn,
            claimable: true,
          },
          null,
          2,
        ),
        `\`\`\``,
      ].join("\n");

      await prisma.extension.upsert({
        where: { ownerHandle_slug: { ownerHandle, slug: ext.slug } },
        update: {
          title: ext.title,
          description: (ext.description || "").slice(0, 500),
          tags,
          latestVersion: ext.latestVersion,
          downloads: BigInt(ext.downloads || 0),
          repositoryUrl: ext.repositoryUrl ?? null,
          sourceGithubOrg: ext.sourceGithubOrg ?? null,
          readme,
        },
        create: {
          ownerHandle,
          ownerKind: "user",
          ownerId: user.id,
          slug: ext.slug,
          title: ext.title,
          description: (ext.description || "").slice(0, 500),
          visibility: "public",
          status: "active",
          availability: "available",
          tags,
          latestVersion: ext.latestVersion,
          downloads: BigInt(ext.downloads || 0),
          stars: 0,
          repositoryUrl: ext.repositoryUrl ?? null,
          sourceGithubOrg: ext.sourceGithubOrg ?? null,
          readme,
        },
      });
      extsUpserted++;
    }
  }

  await prisma.$disconnect();
  console.error(
    `[oxp:import] committed: ${usersUpserted} users, ${extsUpserted} extensions`,
  );
}

main().catch((err) => {
  console.error("[oxp:import] FATAL:", err);
  process.exit(1);
});
