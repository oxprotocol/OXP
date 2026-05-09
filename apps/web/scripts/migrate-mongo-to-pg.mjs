/**
 * One-shot Mongo → Neon Postgres data migration.
 *
 * Reads from MongoDB Atlas (env DATABASE_URL — must still point at Mongo)
 * and writes to Neon Postgres via Prisma client (already targeting PG via
 * NEON_DATABASE_URL/NEON_DIRECT_URL in schema.prisma).
 *
 * Run after `pnpm db:migrate` has created the empty PG schema.
 *   pnpm dotenv -e .env.local -- node scripts/migrate-mongo-to-pg.mjs
 *
 * Idempotent: uses `upsert` on natural keys. Safe to re-run.
 */
import { MongoClient, ObjectId } from "mongodb";
import { PrismaClient } from "@prisma/client";

const mongoUrl = process.env.DATABASE_URL;
if (!mongoUrl?.startsWith("mongodb")) {
  console.error("DATABASE_URL must point at MongoDB for this script.");
  process.exit(1);
}

const mongo = new MongoClient(mongoUrl);
const prisma = new PrismaClient();

await mongo.connect();
const db = mongo.db();

/** Map a Mongo doc's _id to a stable string id for PG. */
const oid = (v) => (v instanceof ObjectId ? v.toHexString() : String(v));

/** Map of Mongo ObjectId hex → PG cuid for FK rewriting. */
const userIdMap = new Map();
const orgIdMap = new Map();
const extIdMap = new Map();

async function migrateUsers() {
  const docs = await db.collection("users").find({}).toArray();
  for (const d of docs) {
    const row = await prisma.user.upsert({
      where: { handle: d.handle },
      create: {
        handle: d.handle,
        email: d.email,
        emailVerified: d.emailVerified ?? null,
        passwordHash: d.passwordHash,
        displayName: d.displayName,
        avatarSeed: d.avatarSeed,
        bio: d.bio ?? null,
        location: d.location ?? null,
        website: d.website ?? null,
        joinedAt: d.joinedAt ?? new Date(),
      },
      update: {},
    });
    userIdMap.set(oid(d._id), row.id);
  }
  console.log(`users: ${docs.length}`);
}

async function migrateOrgs() {
  const docs = await db.collection("organizations").find({}).toArray();
  for (const d of docs) {
    const row = await prisma.organization.upsert({
      where: { handle: d.handle },
      create: {
        handle: d.handle,
        displayName: d.displayName,
        description: d.description ?? null,
        website: d.website ?? null,
        verified: d.verified ?? false,
        createdByUserId: userIdMap.get(oid(d.createdByUserId)) ?? "",
        joinedAt: d.joinedAt ?? new Date(),
      },
      update: {},
    });
    orgIdMap.set(oid(d._id), row.id);
  }
  console.log(`organizations: ${docs.length}`);
}

async function migrateNamespaceHandles() {
  const docs = await db.collection("namespace_handles").find({}).toArray();
  for (const d of docs) {
    const ownerId =
      d.kind === "user"
        ? userIdMap.get(oid(d.ownerId))
        : orgIdMap.get(oid(d.ownerId));
    if (!ownerId) continue;
    await prisma.namespaceHandle.upsert({
      where: { handle: d.handle },
      create: {
        handle: d.handle,
        kind: d.kind,
        ownerId,
        reserved: d.reserved ?? false,
      },
      update: {},
    });
  }
  console.log(`namespace_handles: ${docs.length}`);
}

async function migrateApiTokens() {
  const docs = await db.collection("api_tokens").find({}).toArray();
  for (const d of docs) {
    const userId = userIdMap.get(oid(d.userId));
    if (!userId) continue;
    await prisma.apiToken.upsert({
      where: { tokenHash: d.tokenHash },
      create: {
        userId,
        name: d.name,
        tokenHash: d.tokenHash,
        scopes: d.scopes ?? [],
        lastUsedAt: d.lastUsedAt ?? null,
        createdAt: d.createdAt ?? new Date(),
        expiresAt: d.expiresAt ?? null,
      },
      update: {},
    });
  }
  console.log(`api_tokens: ${docs.length}`);
}

async function migratePublisherKeys() {
  const docs = await db.collection("publisher_keys").find({}).toArray();
  for (const d of docs) {
    const registeredByUserId = userIdMap.get(oid(d.registeredByUserId)) ?? "";
    await prisma.publisherKey.upsert({
      where: { keyId: d.keyId },
      create: {
        publisherHandle: d.publisherHandle,
        algorithm: d.algorithm ?? "ed25519",
        publicKeyPem: d.publicKeyPem,
        keyId: d.keyId,
        registeredAt: d.registeredAt ?? new Date(),
        registeredByUserId,
        revokedAt: d.revokedAt ?? null,
      },
      update: {},
    });
  }
  console.log(`publisher_keys: ${docs.length}`);
}

async function migrateExtensions() {
  const docs = await db.collection("extensions").find({}).toArray();
  for (const d of docs) {
    const ownerId =
      d.ownerKind === "user"
        ? userIdMap.get(oid(d.ownerId))
        : orgIdMap.get(oid(d.ownerId));
    if (!ownerId) continue;
    const row = await prisma.extension.upsert({
      where: { ownerHandle_slug: { ownerHandle: d.ownerHandle, slug: d.slug } },
      create: {
        ownerHandle: d.ownerHandle,
        ownerKind: d.ownerKind,
        ownerId,
        slug: d.slug,
        title: d.title,
        description: d.description,
        visibility: d.visibility ?? "public",
        status: d.status ?? "active",
        availability: d.availability ?? "available",
        tags: d.tags ?? [],
        repositoryUrl: d.repositoryUrl ?? null,
        readme: d.readme ?? null,
        latestVersion: d.latestVersion ?? null,
        downloads: BigInt(d.downloads ?? 0),
        stars: d.stars ?? 0,
        createdAt: d.createdAt ?? new Date(),
        updatedAt: d.updatedAt ?? new Date(),
      },
      update: {},
    });
    extIdMap.set(oid(d._id), row.id);
  }
  console.log(`extensions: ${docs.length}`);
}

async function migrateVersions() {
  const docs = await db.collection("versions").find({}).toArray();
  for (const d of docs) {
    const extensionId = extIdMap.get(oid(d.extensionId));
    const signedByUserId = userIdMap.get(oid(d.signedByUserId)) ?? "";
    if (!extensionId) continue;
    await prisma.version.upsert({
      where: {
        extensionId_semver: { extensionId, semver: d.semver },
      },
      create: {
        extensionId,
        semver: d.semver,
        publishedAt: d.publishedAt ?? new Date(),
        bundleSha256: d.bundleSha256,
        bundleSize: BigInt(d.bundleSize ?? 0),
        bundleMimeType:
          d.bundleMimeType ?? "application/vnd.oxp.bundle.v1.tar+zstd",
        signedByUserId,
        signatureKeyId: d.signatureKeyId,
        signatureAlgo: d.signatureAlgo ?? "ed25519",
        signatureJson: d.signatureJson ?? {},
        manifestJson: d.manifestJson ?? {},
        yankedAt: d.yankedAt ?? null,
        changelog: d.changelog ?? "",
      },
      update: {},
    });
  }
  console.log(`versions: ${docs.length}`);
}

async function migrateAliases() {
  const docs = await db.collection("extension_aliases").find({}).toArray();
  for (const d of docs) {
    const extensionId = extIdMap.get(oid(d.extensionId));
    if (!extensionId) continue;
    await prisma.extensionAlias.upsert({
      where: { alias: d.alias },
      create: {
        alias: d.alias,
        extensionId,
        ownerHandle: d.ownerHandle,
        slug: d.slug,
      },
      update: {},
    });
  }
  console.log(`extension_aliases: ${docs.length}`);
}

async function migrateMcp() {
  const docs = await db.collection("mcp_server_snapshots").find({}).toArray();
  for (const d of docs) {
    await prisma.mcpServerSnapshot.upsert({
      where: { id: d._id },
      create: {
        id: d._id,
        name: d.name,
        publisher: d.publisher,
        description: d.description,
        homepage: d.homepage ?? null,
        repository: d.repository ?? null,
        transports: d.transports ?? [],
        tags: d.tags ?? [],
        featured: d.featured ?? false,
        syncedAt: d.syncedAt ?? new Date(),
        source: d.source,
      },
      update: {},
    });
  }
  console.log(`mcp_server_snapshots: ${docs.length}`);
}

try {
  // Order matters — FKs.
  await migrateUsers();
  await migrateOrgs();
  await migrateNamespaceHandles();
  await migrateApiTokens();
  await migratePublisherKeys();
  await migrateExtensions();
  await migrateVersions();
  await migrateAliases();
  await migrateMcp();
  console.log("\n✅ migration complete");
} finally {
  await mongo.close();
  await prisma.$disconnect();
}
