#!/usr/bin/env node
// Backfill `Extension.sourceGithubOrg` for existing VSX-mirrored rows.
//
// Reads `repositoryUrl` on every Extension that has a vsx-* owner handle
// and a null `sourceGithubOrg`, derives the GitHub org with the same
// parser used by the importer, and updates the row.
//
// Usage:
//   node scripts/backfill-source-github-org.mjs           # dry-run
//   node scripts/backfill-source-github-org.mjs --commit  # write

const COMMIT = process.argv.includes("--commit");

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

const { PrismaClient } =
  await import("../node_modules/@prisma/client/index.js");
const prisma = new PrismaClient();

const rows = await prisma.extension.findMany({
  where: {
    ownerHandle: { startsWith: "vsx-" },
    sourceGithubOrg: null,
  },
  select: { id: true, ownerHandle: true, slug: true, repositoryUrl: true },
});

console.error(`[backfill] scanning ${rows.length} VSX rows…`);

let resolved = 0;
let updates = 0;
const skipped = [];
for (const r of rows) {
  const org = parseGithubOrg(r.repositoryUrl);
  if (!org) {
    skipped.push({
      scoped: `@${r.ownerHandle}/${r.slug}`,
      repo: r.repositoryUrl ?? "(none)",
    });
    continue;
  }
  resolved++;
  if (COMMIT) {
    await prisma.extension.update({
      where: { id: r.id },
      data: { sourceGithubOrg: org },
    });
    updates++;
  } else {
    console.log(`@${r.ownerHandle}/${r.slug}\t→ org=${org}`);
  }
}

console.error(
  `[backfill] resolved=${resolved} updated=${updates} skipped=${skipped.length} (commit=${COMMIT})`,
);
if (skipped.length && !COMMIT) {
  console.error(`[backfill] first 10 skipped (no parseable github repo):`);
  for (const s of skipped.slice(0, 10)) {
    console.error(`  - ${s.scoped}  repo=${s.repo}`);
  }
}

await prisma.$disconnect();
