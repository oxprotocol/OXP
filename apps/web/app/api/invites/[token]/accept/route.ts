/**
 *   POST /api/invites/[token]/accept
 *
 * Caller must be signed in with the email the invite was issued to.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { redeemInvite } from "@/lib/orgs";
import { recordAudit } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { token } = await params;
  const result = await redeemInvite(token, me.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  await recordAudit({
    action: "member.add",
    target: `@${me.handle}`,
    actorUserId: me.id,
    orgId: result.data.orgId,
    metadata: {
      role: result.data.role,
      status: "accepted",
      inviteId: result.data.inviteId,
    },
  });
  return NextResponse.json({
    ok: true,
    org: { id: result.data.orgId, handle: result.data.orgHandle },
    role: result.data.role,
  });
}
