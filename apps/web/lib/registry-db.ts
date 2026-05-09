/**
 * DB-backed listing for the public registry. Used by the /packages browse
 * page (server component) so the directory reflects what's actually been
 * published, not the seed `extensions` mock array.
 *
 * Returns the same `OxpPackage` shape as `lib/packages.ts` so the existing
 * client UI doesn't have to change.
 */
import { prisma } from "@/lib/prisma";
import type { OxpPackage } from "./packages";
import type { Extension, Organization, User, Version } from "./types";

// ─── Handle resolution ───────────────────────────────────────────────────────
export type ResolvedHandleDb =
  | { kind: "user"; user: User }
  | { kind: "org"; org: Organization }
  | { kind: "missing" };

/**
 * DB-first handle resolver. Looks up `handle` in the User table first, then
 * Organization. Returns the same shape as the in-memory `resolveHandle()` so
 * call sites can drop in the result.
 */
export async function resolveHandleDb(
  handle: string,
): Promise<ResolvedHandleDb> {
  const lower = handle.toLowerCase();
  const u = await prisma.user.findUnique({ where: { handle: lower } });
  if (u) {
    return {
      kind: "user",
      user: {
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        email: u.email,
        avatarSeed: u.avatarSeed,
        avatarUrl: u.avatarUrl ?? undefined,
        avatarUpdatedAt: u.avatarUpdatedAt?.toISOString() ?? undefined,
        bio: u.bio ?? undefined,
        location: u.location ?? undefined,
        website: u.website ?? undefined,
        joinedAt: u.joinedAt.toISOString().slice(0, 10),
        subscriptionId: u.subscriptionId ?? undefined,
      },
    };
  }
  const o = await prisma.organization.findUnique({ where: { handle: lower } });
  if (o) {
    return {
      kind: "org",
      org: {
        id: o.id,
        handle: o.handle,
        displayName: o.displayName,
        description: o.description ?? undefined,
        website: o.website ?? undefined,
        verified: o.verified,
        createdByUserId: o.createdByUserId,
        joinedAt: o.joinedAt.toISOString().slice(0, 10),
        subscriptionId: o.subscriptionId ?? undefined,
      },
    };
  }
  return { kind: "missing" };
}

/** DB-backed list of extensions owned by a handle (user or org). */
export async function getExtensionsByOwnerDb(
  ownerHandle: string,
): Promise<Extension[]> {
  const rows = await prisma.extension.findMany({
    where: { ownerHandle: ownerHandle.toLowerCase() },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    ownerHandle: r.ownerHandle,
    ownerKind: r.ownerKind === "org" ? "org" : "user",
    ownerId: r.ownerId,
    slug: r.slug,
    title: r.title,
    description: r.description,
    visibility: r.visibility,
    status: r.status,
    tags: r.tags,
    repositoryUrl: r.repositoryUrl ?? undefined,
    latestVersion: r.latestVersion ?? "0.0.0",
    downloads: formatDownloads(r.downloads),
    stars: r.stars,
    readme: r.readme ?? undefined,
  }));
}

export interface ListPublishedOptions {
  /** Free-text query — matches title, slug, description, ownerHandle (case-insensitive). */
  q?: string;
  /** Filter by exact tag (any-of when multiple). */
  tags?: string[];
  /** Require ALL of these tags (intersection with `tags` if both set). */
  requireTags?: string[];
  /** Drop rows that have ANY of these tags. Used to keep VSX mirrors out
   *  of the OXP-native registry view. */
  excludeTags?: string[];
  /** Filter by publisher handle. */
  publisher?: string;
  /** Pagination — defaults: limit 50 (max 200), offset 0. */
  limit?: number;
  offset?: number;
}

export async function listPublishedPackages(
  opts: ListPublishedOptions = {},
): Promise<OxpPackage[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const where: Record<string, unknown> = {
    visibility: "public",
    status: "active",
  };
  if (opts.publisher) where.ownerHandle = opts.publisher;
  if (opts.tags && opts.tags.length > 0) {
    where.tags = { hasSome: opts.tags };
  }
  if (opts.requireTags && opts.requireTags.length > 0) {
    // Prisma `tags` is a String[] column → `hasEvery` = ALL must be present.
    where.tags = {
      ...(where.tags as object | undefined),
      hasEvery: opts.requireTags,
    };
  }
  if (opts.excludeTags && opts.excludeTags.length > 0) {
    // NOT { tags: { hasSome: [...] } } → row has zero overlap with the list.
    where.NOT = { tags: { hasSome: opts.excludeTags } };
  }
  if (opts.q && opts.q.trim().length > 0) {
    const q = opts.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { ownerHandle: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.extension.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
    select: {
      ownerHandle: true,
      slug: true,
      title: true,
      description: true,
      latestVersion: true,
      downloads: true,
      stars: true,
      tags: true,
      availability: true,
    },
  });

  // Phase B.8 — bulk-resolve verification tier for the publisher handles
  // in a single query so /packages and the public list API stay O(1) for
  // badge rendering. Cheap because both tables are unique-indexed on handle.
  const handles = Array.from(
    new Set(rows.map((r) => r.ownerHandle.toLowerCase())),
  );
  const [users, orgs] = handles.length
    ? await Promise.all([
        prisma.user.findMany({
          where: { handle: { in: handles } },
          select: { handle: true, verificationLevel: true, githubLogin: true },
        }),
        prisma.organization.findMany({
          where: { handle: { in: handles } },
          select: { handle: true, verificationLevel: true },
        }),
      ])
    : [[], []];
  const trust = new Map<
    string,
    {
      level: "unverified" | "github" | "domain";
      githubLogin?: string | null;
    }
  >();
  for (const o of orgs)
    trust.set(o.handle.toLowerCase(), { level: o.verificationLevel });
  for (const u of users)
    trust.set(u.handle.toLowerCase(), {
      level: u.verificationLevel,
      githubLogin: u.githubLogin,
    });

  return rows.map((r) => {
    const t = trust.get(r.ownerHandle.toLowerCase());
    return {
      id: `@${r.ownerHandle}/${r.slug}`,
      legacyId: r.slug,
      title: r.title,
      publisher: r.ownerHandle,
      description: r.description,
      version: r.latestVersion ?? "0.0.0",
      downloads: formatDownloads(r.downloads),
      stars: r.stars,
      tags: r.tags,
      ownerHandle: r.ownerHandle,
      slug: r.slug,
      availability: r.availability === "available" ? "available" : "planned",
      verificationLevel: t?.level ?? "unverified",
      verifiedGithub: t?.githubLogin ?? null,
    };
  });
}

function formatDownloads(n: bigint): string {
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function formatBytes(n: bigint): string {
  const v = Number(n);
  if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

/** DB-backed single-extension lookup, returning the lib/types `Extension` shape. */
export async function getExtensionDb(
  ownerHandle: string,
  slug: string,
): Promise<Extension | null> {
  const r = await prisma.extension.findUnique({
    where: { ownerHandle_slug: { ownerHandle, slug } },
  });
  if (!r) return null;
  return {
    id: r.id,
    ownerHandle: r.ownerHandle,
    ownerKind: r.ownerKind === "org" ? "org" : "user",
    ownerId: r.ownerId,
    slug: r.slug,
    title: r.title,
    description: r.description,
    visibility: r.visibility,
    status: r.status,
    tags: r.tags,
    repositoryUrl: r.repositoryUrl ?? undefined,
    latestVersion: r.latestVersion ?? "0.0.0",
    downloads: formatDownloads(r.downloads),
    stars: r.stars,
    readme: r.readme ?? undefined,
  };
}

/** DB-backed versions for an extension, newest first. */
export async function getVersionsForExtensionDb(
  extensionId: string,
): Promise<Version[]> {
  const rows = await prisma.version.findMany({
    where: { extensionId },
    orderBy: { publishedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    extensionId: r.extensionId,
    semver: r.semver,
    publishedAt: r.publishedAt.toISOString().slice(0, 10),
    bundleSize: formatBytes(r.bundleSize),
    signedByUserId: r.signedByUserId,
    yankedAt: r.yankedAt?.toISOString(),
    changelog: r.changelog,
  }));
}
