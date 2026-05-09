/**
 *   DELETE /api/org/[handle]/members/invites/[id]   → revoke a pending invite
 */
import { NextResponse } from "next/server";
import { loadOrgContext, OrgAuthError } from "@/lib/org-auth";
import { revokeInvite } from "@/lib/orgs";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ handle: string; id: string }> },
) {
  try {
    const { handle, id } = await params;
    const ctx = await loadOrgContext(handle);
    const invite = await prisma.orgInvite.findUnique({ where: { id } });
    if (!invite || invite.orgId !== ctx.org.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const ok = await revokeInvite(ctx.org.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "already accepted or revoked" },
        { status: 409 },
      );
    }
    await recordAudit({
      action: "member.remove",
      target: invite.email,
      actorUserId: ctx.user.id,
      orgId: ctx.org.id,
      metadata: { inviteId: id, status: "revoked" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OrgAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[invite revoke]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
