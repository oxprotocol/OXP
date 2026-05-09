import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const BASE =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://oxp.sh";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/pricing",
    "/docs",
    "/mcp",
    "/vsx",
    "/community",
    "/trust",
    "/security",
    "/status",
    "/launch",
    "/publish",
    "/signin",
    "/legal",
    "/sla",
    "/rfcs",
  ].map((path) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1.0 : 0.7,
  }));

  let extensionRoutes: MetadataRoute.Sitemap = [];
  try {
    const exts = await prisma.extension.findMany({
      select: { ownerHandle: true, slug: true, updatedAt: true },
      take: 5000,
      orderBy: { updatedAt: "desc" },
    });
    extensionRoutes = exts.map((e) => ({
      url: `${BASE}/@${e.ownerHandle}/${e.slug}`,
      lastModified: e.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));
  } catch {
    // DB unavailable — still serve the static section.
  }

  return [...staticRoutes, ...extensionRoutes];
}
