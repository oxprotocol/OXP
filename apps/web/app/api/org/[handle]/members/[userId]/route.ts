/**
 *   PATCH  /api/org/[handle]/members/[userId]   { role }
 *   DELETE /api/org/[handle]/members/[userId]
 */
import { NextResponse } from "next/server";
import { loadOrgContext, OrgAuthError } from "@/lib/org-auth";
import { changeMemberRole, removeMember } from "@/lib/orgs";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { OrgRole } from "@prisma/client";

const VALID: OrgRole[] = ["owner", "admin", "contributor", "reader"];

function errorResponse(e: unknown) {
  if (e instanceof OrgAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[org/members/userId] error", e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

async function targetHandle(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true },
  });
  return u ? `@${u.handle}` : userId;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ handle: string; userId: string }> },
) {
  try {
    const { handle, userId } = await params;
    const ctx = await loadOrgContext(handle);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    const role = (body as { role?: OrgRole }).role;
    if (!role || !VALID.includes(role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }
    // Only owners may grant/revoke owner role.
    if (role === "owner" && ctx.membership.role !== "owner") {
      return NextResponse.json(
        { error: "only owners may promote to owner" },
        { status: 403 },
      );
    }
    const result = await changeMemberRole(ctx.org.id, userId, role);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    await recordAudit({
      action: "member.role",
      target: await targetHandle(userId),
      actorUserId: ctx.user.id,
      orgId: ctx.org.id,
      metadata: { userId, role },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ handle: string; userId: string }> },
) {
  try {
    const { handle, userId } = await params;
    const ctx = await loadOrgContext(handle);
    // Self-removal is allowed except for the last owner (handled in lib).
    const result = await removeMember(ctx.org.id, userId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    await recordAudit({
      action: "member.remove",
      target: await targetHandle(userId),
      actorUserId: ctx.user.id,
      orgId: ctx.org.id,
      metadata: { userId, self: userId === ctx.user.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
