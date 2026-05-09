/**
 * POST /api/v1/auth/logout — revoke the bearer token used to authenticate.
 *
 * Used by `oxp logout` so the local credential is invalidated server-side
 * (not just deleted from `~/.oxp/credentials`). Idempotent: if the token is
 * already gone we still return 200.
 *
 * Response 200: { ok: true }
 * Response 401: { error: ... } — only when the auth header itself is malformed
 *   or the token isn't recognised at all. A token that has expired is still
 *   considered "logged out" and returns 200.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await authenticateBearer(req);
  if (!auth.ok) {
    // Treat "expired" as already-logged-out so the CLI never loops.
    if (auth.error === "token expired") {
      return NextResponse.json(
        { ok: true },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "cache-control": "no-store" } },
    );
  }
  const tokenId = auth.auth.token.id;
  const userId = auth.auth.user.id;
  await prisma.apiToken.delete({ where: { id: tokenId } }).catch(() => {}); // already gone is fine
  await recordAudit({
    action: "token.revoke",
    target: tokenId,
    actorUserId: userId,
    metadata: { source: "cli-logout" },
  });
  return NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
}
