/**
 *   GET    /api/org/[handle]/members        → list members + pending invites
 *   POST   /api/org/[handle]/members        → invite by email
 *
 * Member-mutation endpoints (role change / remove) live under
 *   /api/org/[handle]/members/[userId]
 *
 * Invitation revoke lives under
 *   /api/org/[handle]/members/invites/[id]
 */
import { NextResponse } from "next/server";
import {
  loadOrgContext,
  loadOrgMemberContext,
  OrgAuthError,
} from "@/lib/org-auth";
import { listOrgMembers, listOrgInvites, createInvite } from "@/lib/orgs";
import { recordAudit } from "@/lib/audit";
import type { OrgRole } from "@prisma/client";

function errorResponse(e: unknown) {
  if (e instanceof OrgAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[org/members] error", e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgMemberContext(handle);
    const [members, invites] = await Promise.all([
      listOrgMembers(ctx.org.id),
      // Only owner/admin sees pending invites.
      ctx.membership.role === "owner" || ctx.membership.role === "admin"
        ? listOrgInvites(ctx.org.id)
        : Promise.resolve([]),
    ]);
    return NextResponse.json({ members, invites });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle); // owner/admin gate
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    const b = body as { email?: string; role?: OrgRole };
    const email = String(b.email ?? "")
      .trim()
      .toLowerCase();
    const role = (b.role ?? "contributor") as OrgRole;
    const result = await createInvite({
      orgId: ctx.org.id,
      invitedById: ctx.user.id,
      email,
      role,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    await recordAudit({
      action: "member.add",
      target: email,
      actorUserId: ctx.user.id,
      orgId: ctx.org.id,
      metadata: { role, status: "invited", inviteId: result.inviteId },
    });
    // Returning the raw token once — caller copies it as a magic link.
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host") ?? "oxp.sh";
    const acceptUrl = `${proto}://${host}/invite/${result.token}`;
    return NextResponse.json(
      {
        ok: true,
        inviteId: result.inviteId,
        acceptUrl,
        expiresAt: result.expiresAt,
      },
      { status: 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
