/**
 * GET /api/v1/extensions
 *
 * Public, unauthenticated read API for the registry. Lists published
 * extensions (visibility=public, status=active). Closes the gap noted
 * in session memory: previously hosts had to know `@publisher/slug`
 * upfront because no list endpoint existed.
 *
 * Query params (all optional):
 *   - q          free-text match on title/slug/description/handle
 *   - tag        repeatable: ?tag=ai&tag=editor (any-of)
 *   - publisher  filter by exact owner handle
 *   - limit      1..200, default 50
 *   - offset     0..N, default 0
 *
 * Response:
 *   { ok: true, items: OxpPackage[], limit, offset, count }
 *
 * `count` is the page size (items.length), NOT the total — keeping the
 * endpoint cheap. A future `?withTotal=1` variant can add COUNT(*) when
 * a UI needs pagination footers.
 */
import { NextResponse } from "next/server";
import { listPublishedPackages } from "@/lib/registry-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const publisher = url.searchParams.get("publisher") ?? undefined;
  const tags = url.searchParams.getAll("tag");
  const limit = parseIntOrUndef(url.searchParams.get("limit"));
  const offset = parseIntOrUndef(url.searchParams.get("offset"));

  // `kind` selector: native (default) | vsx | all
  // OXP-native is the headline product; VSX mirrors are an opt-in surface.
  const kind = url.searchParams.get("kind") ?? "native";
  const requireTags: string[] | undefined =
    kind === "vsx" ? ["vsx-compatible"] : undefined;
  const excludeTags: string[] | undefined =
    kind === "native" ? ["vsx-compatible"] : undefined;

  try {
    const items = await listPublishedPackages({
      q,
      tags: tags.length > 0 ? tags : undefined,
      requireTags,
      excludeTags,
      publisher,
      limit,
      offset,
    });

    return NextResponse.json(
      {
        ok: true,
        items,
        limit: limit ?? 50,
        offset: offset ?? 0,
        count: items.length,
      },
      {
        headers: {
          // Short cache so the directory feels live but doesn't hammer Postgres.
          "cache-control": "public, max-age=15, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    console.error("[GET /api/v1/extensions] failed:", err);
    return NextResponse.json(
      { ok: false, error: "registry unavailable" },
      { status: 503 },
    );
  }
}

function parseIntOrUndef(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
