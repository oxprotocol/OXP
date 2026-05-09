/**
 * GET /api/v1/extensions/{publisher}/{slug}/versions/{semver}/signature
 *   → application/vnd.oxp.signature.v1+json — the Ed25519Signature blob
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ publisher: string; slug: string; semver: string }> },
): Promise<Response> {
  const { publisher, slug, semver } = await ctx.params;
  const ext = await prisma.extension.findUnique({
    where: { ownerHandle_slug: { ownerHandle: publisher, slug } },
    select: { id: true },
  });
  if (!ext)
    return NextResponse.json(
      { ok: false, error: "extension not found" },
      { status: 404 },
    );

  const v = await prisma.version.findUnique({
    where: { extensionId_semver: { extensionId: ext.id, semver } },
    select: {
      signatureJson: true,
      signatureKeyId: true,
      signatureAlgo: true,
      yankedAt: true,
    },
  });
  if (!v)
    return NextResponse.json(
      { ok: false, error: "version not found" },
      { status: 404 },
    );
  if (v.yankedAt)
    return NextResponse.json(
      { ok: false, error: "version yanked" },
      { status: 410 },
    );

  return NextResponse.json(v.signatureJson, {
    headers: {
      "content-type": "application/vnd.oxp.signature.v1+json",
      "x-oxp-signature-key-id": v.signatureKeyId,
      "x-oxp-signature-algo": v.signatureAlgo,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
