/**
 * GET /api/v1/auth/whoami — identify the bearer-token holder.
 *
 * Used by `oxp whoami` to show who the local credentials belong to and what
 * the token can do, without revealing the token itself.
 *
 * Response 200:
 *   {
 *     ok: true,
 *     handle: "aldgar" | null,
 *     email: "...",
 *     token: { id, name, scopes, createdAt, expiresAt, lastUsedAt }
 *   }
 *
 * Response 401: { error: "invalid_token" | "missing bearer token" | "token expired" }
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateBearer(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "cache-control": "no-store" } },
    );
  }
  const { user, token } = auth.auth;
  return NextResponse.json(
    {
      ok: true,
      handle: user.handle,
      email: user.email,
      token: {
        id: token.id,
        name: token.name,
        scopes: token.scopes,
        createdAt: token.createdAt.toISOString(),
        expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
        lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
