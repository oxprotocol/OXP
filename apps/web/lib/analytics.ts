/**
 * Install analytics — Pro+ feature.
 *
 * Reads the `installs` table and aggregates per-publisher metrics for the
 * dashboard. All queries are scoped to extensions owned by the current
 * caller (user handle + org handles) so a user can only see their own data.
 */

import { prisma } from "@/lib/prisma";

export interface InstallTotals {
  total: number;
  last30d: number;
  last7d: number;
  uniqueUsers: number;
}

export interface DailyPoint {
  /** ISO date string (yyyy-mm-dd, UTC). */
  date: string;
  count: number;
}

export interface EditorBreakdown {
  editor: string;
  count: number;
}

export interface ExtensionRow {
  extensionId: string;
  ownerHandle: string;
  slug: string;
  title: string;
  total: number;
  last30d: number;
}

export interface AnalyticsSummary {
  extensionIds: string[];
  totals: InstallTotals;
  daily: DailyPoint[];
  editors: EditorBreakdown[];
  perExtension: ExtensionRow[];
}

/** Owned extension ids for a user handle + their org handles. */
export async function getOwnedExtensionIds(
  ownerHandles: string[],
): Promise<{ id: string; ownerHandle: string; slug: string; title: string }[]> {
  if (ownerHandles.length === 0) return [];
  const rows = await prisma.extension.findMany({
    where: { ownerHandle: { in: ownerHandles.map((h) => h.toLowerCase()) } },
    select: { id: true, ownerHandle: true, slug: true, title: true },
  });
  return rows;
}

export async function getInstallAnalytics(
  ownerHandles: string[],
): Promise<AnalyticsSummary> {
  const owned = await getOwnedExtensionIds(ownerHandles);
  const ids = owned.map((e) => e.id);

  if (ids.length === 0) {
    return {
      extensionIds: [],
      totals: { total: 0, last30d: 0, last7d: 0, uniqueUsers: 0 },
      daily: [],
      editors: [],
      perExtension: [],
    };
  }

  const now = Date.now();
  const day = 86_400_000;
  const since30 = new Date(now - 30 * day);
  const since7 = new Date(now - 7 * day);

  const [
    total,
    last30d,
    last7d,
    uniqueUsersAgg,
    editorRows,
    perExtRows,
    perExtRecent,
  ] = await Promise.all([
    prisma.install.count({ where: { extensionId: { in: ids } } }),
    prisma.install.count({
      where: { extensionId: { in: ids }, installedAt: { gte: since30 } },
    }),
    prisma.install.count({
      where: { extensionId: { in: ids }, installedAt: { gte: since7 } },
    }),
    prisma.install.findMany({
      where: { extensionId: { in: ids } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.install.groupBy({
      by: ["editor"],
      where: { extensionId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.install.groupBy({
      by: ["extensionId"],
      where: { extensionId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.install.groupBy({
      by: ["extensionId"],
      where: { extensionId: { in: ids }, installedAt: { gte: since30 } },
      _count: { _all: true },
    }),
  ]);

  // Per-day install counts for last 30 days, filled with zeros for empty days.
  const dailyRaw = await prisma.$queryRaw<{ d: Date; c: bigint }[]>`
    SELECT date_trunc('day', "installedAt") AS d, COUNT(*)::bigint AS c
    FROM "installs"
    WHERE "extensionId" = ANY(${ids}::text[])
      AND "installedAt" >= ${since30}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  const dailyMap = new Map<string, number>();
  for (const r of dailyRaw) {
    dailyMap.set(r.d.toISOString().slice(0, 10), Number(r.c));
  }
  const daily: DailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * day).toISOString().slice(0, 10);
    daily.push({ date: d, count: dailyMap.get(d) ?? 0 });
  }

  const recentMap = new Map(
    perExtRecent.map((r) => [r.extensionId, r._count._all]),
  );
  const extMeta = new Map(owned.map((e) => [e.id, e]));
  const perExtension: ExtensionRow[] = perExtRows
    .map((r) => {
      const meta = extMeta.get(r.extensionId)!;
      return {
        extensionId: r.extensionId,
        ownerHandle: meta.ownerHandle,
        slug: meta.slug,
        title: meta.title,
        total: r._count._all,
        last30d: recentMap.get(r.extensionId) ?? 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    extensionIds: ids,
    totals: {
      total,
      last30d,
      last7d,
      uniqueUsers: uniqueUsersAgg.length,
    },
    daily,
    editors: editorRows
      .map((r) => ({ editor: r.editor, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    perExtension,
  };
}
