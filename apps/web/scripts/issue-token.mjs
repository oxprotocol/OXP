#!/usr/bin/env node
/**
 * Dev helper: issue an API token for a given handle.
 * Creates the User record if it does not exist (dev only — bypasses auth).
 *
 * Usage:
 *   node scripts/issue-token.mjs <handle> [--scope SCOPE]... [--days N] [--no-expiry]
 *
 * Defaults (Phase A.8):
 *   --scope publish:@<handle>/*     (namespace-wide publish)
 *   --days  90                       (token expires in 90 days)
 *
 * Prints the raw token to stdout exactly once. Pipe into `oxp login`.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: ".env.local" });
config({ path: ".env" });

const argv = process.argv.slice(2);
const handle = argv.shift();
if (!handle || handle.startsWith("--")) {
  console.error(
    "usage: node scripts/issue-token.mjs <handle> [--scope S]... [--days N] [--no-expiry]",
  );
  process.exit(2);
}

const scopes = [];
let days = 90;
let noExpiry = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--scope") scopes.push(argv[++i]);
  else if (a === "--days") {
    const n = Number(argv[++i]);
    if (!Number.isFinite(n) || n <= 0) {
      console.error("--days must be a positive number");
      process.exit(2);
    }
    days = Math.floor(n);
  } else if (a === "--no-expiry") noExpiry = true;
  else {
    console.error(`unknown flag: ${a}`);
    process.exit(2);
  }
}
if (scopes.length === 0) scopes.push(`publish:@${handle}/*`);

const prisma = new PrismaClient();

try {
  let user = await prisma.user.findUnique({ where: { handle } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        handle,
        email: `${handle}@dev.local`,
        passwordHash: "!", // unusable
        displayName: handle,
        avatarSeed: handle,
      },
    });
    // Reserve the namespace handle so publishes route to this user.
    await prisma.namespaceHandle
      .create({
        data: { handle, kind: "user", ownerId: user.id, reserved: false },
      })
      .catch(() => {});
    console.error(`created user @${handle} (${user.id})`);
  }

  const raw = `oxp_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const expiresAt = noExpiry
    ? null
    : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await prisma.apiToken.create({
    data: {
      userId: user.id,
      name: `dev-token-${new Date().toISOString().slice(0, 10)}`,
      tokenHash,
      scopes,
      expiresAt,
    },
  });

  console.error(
    `issued token for @${handle} (scopes: ${scopes.join(",")}, expires: ${expiresAt?.toISOString() ?? "never"})`,
  );
  console.log(raw);
} finally {
  await prisma.$disconnect();
}
