/**
 * GET /api/v1/publishers/{handle}/keys
 *   → { keys: [{ keyId, algorithm, publicKeyPem, registeredAt, revokedAt? }] }
 *
 * Public. Used by `oxp install` to verify Ed25519 signatures.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { handle } = await ctx.params;
  const keys = await prisma.publisherKey.findMany({
    where: { publisherHandle: handle },
    orderBy: { registeredAt: "asc" },
    select: {
      keyId: true,
      algorithm: true,
      publicKeyPem: true,
      registeredAt: true,
      revokedAt: true,
    },
  });
  return NextResponse.json(
    { handle, keys },
    {
      // Security-sensitive: pinned-key data must not linger in caches.
      // 5 s shared-cache window keeps the registry responsive while
      // ensuring revocations / new registrations propagate quickly.
      headers: {
        "cache-control":
          "public, max-age=5, s-maxage=5, stale-while-revalidate=10",
      },
    },
  );
}
