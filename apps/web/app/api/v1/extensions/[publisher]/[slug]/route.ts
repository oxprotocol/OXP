/**
 * GET /api/v1/extensions/{publisher}/{slug}
 *
 * Public metadata for a single extension. Includes parsed VSX-mirror block
 * (when present in `readme`) so the CLI install command can short-circuit
 * to `code --install-extension <ns>.<name>` instead of running the wasm
 * verify/install pipeline.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseVsxMeta } from "@/lib/vsx-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ publisher: string; slug: string }> },
): Promise<Response> {
  const { publisher, slug } = await params;
  const ext = await prisma.extension.findUnique({
    where: {
      ownerHandle_slug: {
        ownerHandle: publisher.toLowerCase(),
        slug: slug.toLowerCase(),
      },
    },
    select: {
      ownerHandle: true,
      slug: true,
      title: true,
      description: true,
      tags: true,
      visibility: true,
      status: true,
      latestVersion: true,
      downloads: true,
      stars: true,
      readme: true,
      repositoryUrl: true,
    },
  });
  if (!ext || ext.visibility !== "public" || ext.status !== "active") {
    return NextResponse.json(
      { ok: false, error: "extension not found" },
      { status: 404 },
    );
  }

  const vsx = parseVsxMeta(ext.readme);

  // Derive `claimable` from the owner User's passwordHash sentinel rather
  // than a JSON flag — single source of truth, survives schema changes.
  let claimable = false;
  if (vsx) {
    const owner = await prisma.user
      .findUnique({
        where: { handle: ext.ownerHandle },
        select: { passwordHash: true },
      })
      .catch(() => null);
    claimable = !!owner?.passwordHash?.startsWith("vsx-claimable:");
  }

  return NextResponse.json(
    {
      ok: true,
      id: `@${ext.ownerHandle}/${ext.slug}`,
      ownerHandle: ext.ownerHandle,
      slug: ext.slug,
      title: ext.title,
      description: ext.description,
      tags: ext.tags,
      latestVersion: ext.latestVersion,
      downloads: Number(ext.downloads),
      stars: ext.stars,
      repositoryUrl: ext.repositoryUrl,
      vsx,
      claimable,
    },
    {
      headers: {
        "cache-control": "public, max-age=15, stale-while-revalidate=60",
      },
    },
  );
}
