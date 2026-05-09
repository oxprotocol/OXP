/**
 * Server component: loads OXP-NATIVE published extensions from Postgres.
 *
 * Explicitly excludes VSX-mirrored entries (tag `vsx-compatible`) — those
 * live at /vsx so the main registry stays focused on packages built for
 * the OXP runtime. The seed mock array is left in for legacy demo rows.
 */
import { packages as seedPackages } from "@/lib/packages";
import { listPublishedPackages } from "@/lib/registry-db";
import { getPublisherLevels } from "@/lib/publisher-level";
import { PackagesBrowseClient } from "./PackagesBrowseClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Extensions" };

export default async function PackagesBrowsePage() {
  let dbPackages: typeof seedPackages = [];
  try {
    dbPackages = await listPublishedPackages({
      excludeTags: ["vsx-compatible"],
    });
  } catch (err) {
    console.error("[/packages] DB query failed, using seed only:", err);
  }

  // Dedupe by id; DB rows win over seed.
  const byId = new Map<string, (typeof seedPackages)[number]>();
  for (const p of seedPackages) byId.set(p.id, p);
  for (const p of dbPackages) byId.set(p.id, p);
  const merged = Array.from(byId.values()).filter(
    (p) => !p.tags?.includes("vsx-compatible"),
  );

  // Phase B.8 — bulk-resolve verification tier for the publisher handles.
  let levels: Map<string, "unverified" | "github" | "domain"> = new Map();
  try {
    levels = await getPublisherLevels(merged.map((p) => p.ownerHandle));
  } catch (err) {
    console.error("[/packages] publisher-levels lookup failed:", err);
  }

  const initialPackages = merged.map((p) => ({
    ...p,
    verificationLevel: levels.get(p.ownerHandle.toLowerCase()) ?? "unverified",
  }));

  return <PackagesBrowseClient initialPackages={initialPackages} />;
}
