/**
 * API token authentication for the OXP registry write API.
 *
 * Tokens are issued by the user via the dashboard and stored as sha256
 * hashes in the ApiToken table. Clients pass them as `Authorization: Bearer
 * oxp_xxx`.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { User, ApiToken } from "@prisma/client";

export interface AuthedRequest {
  user: User;
  token: ApiToken;
}

export type AuthResult =
  | { ok: true; auth: AuthedRequest }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Verify a Bearer token from a Request and return the owning user.
 * Updates `lastUsedAt` on success.
 */
export async function authenticateBearer(req: Request): Promise<AuthResult> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!m) return { ok: false, status: 401, error: "missing bearer token" };

  const raw = m[1]!.trim();
  const tokenHash = createHash("sha256").update(raw).digest("hex");

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash },
  });
  if (!token) return { ok: false, status: 401, error: "invalid token" };
  if (token.expiresAt && token.expiresAt < new Date()) {
    return { ok: false, status: 401, error: "token expired" };
  }

  const user = await prisma.user.findUnique({ where: { id: token.userId } });
  if (!user) return { ok: false, status: 401, error: "token owner not found" };

  // Fire-and-forget update of lastUsedAt; don't block the request on it.
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { ok: true, auth: { user, token } };
}

/** Check a token has the named scope. */
export function hasScope(token: ApiToken, scope: string): boolean {
  return token.scopes.includes(scope) || token.scopes.includes("*");
}
