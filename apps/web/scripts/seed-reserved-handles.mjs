/**
 * Seed reserved namespace handles.
 *
 * Reserved handles cannot be claimed by random sign-ups. They sit owned by
 * a system user (`@system`) until the legitimate party requests the handle
 * via the (manual, for now) namespace-transfer flow.
 *
 * Idempotent. Safe to re-run.
 *   pnpm dotenv -e .env.local -- node scripts/seed-reserved-handles.mjs
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const RESERVED = [
  // First-party + AI vendors we want to control.
  "anthropic",
  "openai",
  "microsoft",
  "github",
  "gitlab",
  "jetbrains",
  "google",
  // Common impersonation targets — block to avoid squatting.
  "oxp",
  "official",
  "admin",
  "root",
  "support",
  "system",
  "vsx",
  "vscode",
  "piye",
];

const prisma = new PrismaClient();

try {
  // 1. System user that owns reservations.
  const systemEmail = "system@oxp.sh";
  const systemPasswordHash = await bcrypt.hash(
    randomBytes(32).toString("hex"),
    10,
  );
  const system = await prisma.user.upsert({
    where: { email: systemEmail },
    create: {
      handle: "system",
      email: systemEmail,
      passwordHash: systemPasswordHash,
      displayName: "OXP System",
      avatarSeed: "system",
      bio: "Reserved namespace owner. Not a real user.",
    },
    update: {},
  });
  console.log(`system user: ${system.id}`);

  // 2. Reserved namespace handles.
  let created = 0;
  let existing = 0;
  for (const handle of RESERVED) {
    const result = await prisma.namespaceHandle.upsert({
      where: { handle },
      create: {
        handle,
        kind: "user",
        ownerId: system.id,
        reserved: true,
      },
      update: {
        // If a row already exists but is not flagged reserved, force-flag it.
        reserved: true,
      },
    });
    if (result.reserved) existing++;
    else created++;
  }
  console.log(`reserved handles: ${RESERVED.length} (upserted)`);
  console.log("   →", RESERVED.map((h) => "@" + h).join(", "));

  // 3. Verify.
  const all = await prisma.namespaceHandle.findMany({
    where: { reserved: true },
    select: { handle: true },
    orderBy: { handle: "asc" },
  });
  console.log(`\n✅ ${all.length} reserved namespaces in DB`);
} finally {
  await prisma.$disconnect();
}
