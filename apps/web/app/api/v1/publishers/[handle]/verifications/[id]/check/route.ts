/**
 * POST /api/v1/publishers/{handle}/verifications/{id}/check
 *   Auth: Bearer with `publisher:verify` scope, owner-only.
 *   → { ok, status, observedRecords }
 *
 * Triggers a DNS lookup against the recorded challenge host. Idempotent —
 * already-verified challenges short-circuit. Repeated failures are allowed
 * until `expiresAt`.
 */

import { NextResponse } from "next/server";
import { authenticateBearer, hasScope } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkDnsChallenge } from "@/lib/publisher-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ handle: string; id: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth.ok) return jsonError(auth.status, auth.error);
  if (!hasScope(auth.auth.token, "publisher:verify")) {
    return jsonError(403, "token missing 'publisher:verify' scope");
  }

  const { handle, id } = await ctx.params;
  const lower = handle.toLowerCase();
  if (auth.auth.user.handle !== lower) {
    return jsonError(
      403,
      `token owner @${auth.auth.user.handle} cannot verify @${lower}`,
    );
  }

  const row = await prisma.publisherVerification.findUnique({
    where: { id },
    select: { id: true, handle: true },
  });
  if (!row || row.handle !== lower) {
    return jsonError(404, "verification not found");
  }

  const result = await checkDnsChallenge(id);
  return NextResponse.json(
    {
      ok: result.ok,
      status: result.verification.status,
      verifiedAt: result.verification.verifiedAt?.toISOString() ?? null,
      reason: result.verification.reason ?? null,
      observedRecords: result.observedRecords,
    },
    { status: result.ok ? 200 : 422 },
  );
}

function jsonError(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status });
}
