/**
 * GET  /api/v1/publishers/{handle}/verifications
 *   → { handle, verified, verifications: [...] }
 *   Public. Powers the verified badge + tooltip.
 *
 * POST /api/v1/publishers/{handle}/verifications
 *   Body: { method: "dns_txt", target: "<domain>" }
 *   Auth: Bearer token. Caller must own the handle (user.handle === handle
 *   or org membership) — until org membership lookup ships, the strict
 *   match is "user.handle === handle".
 *   → 201 { verification: { id, host, expectedRecord, expiresAt } }
 *
 * The token itself is included in `expectedRecord` ONCE — the user copies
 * it into their DNS provider. Listing later only returns the metadata.
 */

import { NextResponse } from "next/server";
import { authenticateBearer, hasScope } from "@/lib/api-auth";
import {
  challengeHost,
  challengeRecord,
  createDnsChallenge,
  isHandleVerified,
  listVerifications,
} from "@/lib/publisher-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { handle } = await ctx.params;
  const lower = handle.toLowerCase();
  const [verified, verifications] = await Promise.all([
    isHandleVerified(lower),
    listVerifications(lower),
  ]);
  return NextResponse.json(
    {
      handle: lower,
      verified,
      verifications: verifications.map((v) => ({
        id: v.id,
        method: v.method,
        target: v.target,
        status: v.status,
        verifiedAt: v.verifiedAt?.toISOString() ?? null,
        revokedAt: v.revokedAt?.toISOString() ?? null,
        expiresAt: v.expiresAt.toISOString(),
        // token NEVER returned here.
      })),
    },
    {
      headers: {
        "cache-control":
          "public, max-age=10, s-maxage=10, stale-while-revalidate=30",
      },
    },
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth.ok) return jsonError(auth.status, auth.error);
  if (!hasScope(auth.auth.token, "publisher:verify")) {
    return jsonError(403, "token missing 'publisher:verify' scope");
  }

  const { handle } = await ctx.params;
  const lower = handle.toLowerCase();

  // Ownership check: the only "user" handle that the caller can verify is
  // their own. Org-handle ownership lookup lands when org admin UX does.
  if (auth.auth.user.handle !== lower) {
    return jsonError(
      403,
      `token owner @${auth.auth.user.handle} cannot verify @${lower}`,
    );
  }

  let body: { method?: string; target?: string };
  try {
    body = (await req.json()) as { method?: string; target?: string };
  } catch {
    return jsonError(400, "body must be JSON");
  }
  if (body.method !== "dns_txt") {
    return jsonError(400, "only method=dns_txt is supported in this phase");
  }
  if (typeof body.target !== "string" || !body.target.trim()) {
    return jsonError(400, "target (apex domain) is required");
  }

  let v;
  try {
    v = await createDnsChallenge({
      handle: lower,
      domain: body.target,
      createdByUserId: auth.auth.user.id,
    });
  } catch (e) {
    return jsonError(422, (e as Error).message);
  }

  return NextResponse.json(
    {
      verification: {
        id: v.id,
        handle: v.handle,
        method: v.method,
        target: v.target,
        status: v.status,
        host: challengeHost(v.target),
        expectedRecord: challengeRecord(v.token),
        expiresAt: v.expiresAt.toISOString(),
      },
    },
    { status: 201 },
  );
}

function jsonError(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status });
}
