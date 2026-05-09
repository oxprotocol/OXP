/**
 * Custom domain config for an org.
 *
 *   GET    /api/org/[handle]/domain          → current row (or null)
 *   PUT    /api/org/[handle]/domain          → { hostname }
 *   POST   /api/org/[handle]/domain/verify   (separate route)
 *   DELETE /api/org/[handle]/domain
 */
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { loadOrgContext, requireTeamsPlus, OrgAuthError } from "@/lib/org-auth";
import {
  isValidHostname,
  isBlockedHost,
  verifyRecordName,
} from "@/lib/dns-verify";
import { invalidateCustomDomain } from "@/lib/custom-domain";
import { recordAudit } from "@/lib/audit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireTeamsPlus(ctx);
    const row = await prisma.orgDomain.findFirst({
      where: { orgId: ctx.org.id },
    });
    if (!row) return NextResponse.json({ domain: null });
    return NextResponse.json({
      domain: {
        id: row.id,
        hostname: row.hostname,
        status: row.status,
        verifyToken: row.verifyToken,
        recordName: verifyRecordName(row.hostname),
        lastCheckedAt: row.lastCheckedAt,
        lastError: row.lastError,
        verifiedAt: row.verifiedAt,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireTeamsPlus(ctx);
    const body = (await req.json()) as { hostname?: string };
    const hostname = String(body.hostname ?? "")
      .trim()
      .toLowerCase();
    if (!isValidHostname(hostname)) {
      return NextResponse.json({ error: "invalid hostname" }, { status: 400 });
    }
    if (isBlockedHost(hostname)) {
      return NextResponse.json(
        { error: "hostname not allowed" },
        { status: 400 },
      );
    }
    // Uniqueness across ALL orgs.
    const existing = await prisma.orgDomain.findUnique({ where: { hostname } });
    if (existing && existing.orgId !== ctx.org.id) {
      return NextResponse.json(
        { error: "hostname already claimed" },
        { status: 409 },
      );
    }
    const verifyToken = "oxp-verify-" + randomBytes(16).toString("hex");
    const row = await prisma.orgDomain.upsert({
      where: { hostname },
      create: { orgId: ctx.org.id, hostname, verifyToken, status: "pending" },
      update: { verifyToken, status: "pending", lastError: null },
    });
    invalidateCustomDomain(hostname);
    await recordAudit({
      action: "org.update",
      target: hostname,
      actorUserId: ctx.user.id,
      orgId: ctx.org.id,
      metadata: { domain: hostname, status: "pending" },
    });
    return NextResponse.json({
      domain: {
        id: row.id,
        hostname: row.hostname,
        status: row.status,
        verifyToken: row.verifyToken,
        recordName: verifyRecordName(row.hostname),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireTeamsPlus(ctx);
    const existing = await prisma.orgDomain.findMany({
      where: { orgId: ctx.org.id },
      select: { hostname: true },
    });
    await prisma.orgDomain.deleteMany({ where: { orgId: ctx.org.id } });
    for (const d of existing) invalidateCustomDomain(d.hostname);
    if (existing.length > 0) {
      await recordAudit({
        action: "org.update",
        target: existing.map((d) => d.hostname).join(","),
        actorUserId: ctx.user.id,
        orgId: ctx.org.id,
        metadata: { removed: existing.map((d) => d.hostname) },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown): Response {
  const err = e as OrgAuthError;
  if (err && typeof err.status === "number") {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[org/domain]", e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
