/**
 *   POST /api/orgs   { handle, displayName, description?, website? }
 *
 * Any signed-in user can create an org; the row is associated to the
 * caller as `owner` and the handle is reserved in NamespaceHandle. Plan
 * enforcement (Teams gating) lives at /api/billing — the registry itself
 * is happy to host an empty Free org for solo devs collaborating with a
 * friend.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createOrganization } from "@/lib/orgs";
import { recordAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const result = await createOrganization(me.id, {
    handle: String(b.handle ?? ""),
    displayName: String(b.displayName ?? ""),
    description: typeof b.description === "string" ? b.description : undefined,
    website: typeof b.website === "string" ? b.website : undefined,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  await recordAudit({
    action: "org.create",
    target: `@${result.handle}`,
    actorUserId: me.id,
    orgId: result.orgId,
    metadata: { handle: result.handle },
  });
  return NextResponse.json(
    { ok: true, orgId: result.orgId, handle: result.handle },
    { status: 201 },
  );
}
