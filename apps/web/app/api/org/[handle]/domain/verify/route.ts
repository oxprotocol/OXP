/**
 * POST /api/org/[handle]/domain/verify
 *
 * Run a live DNS TXT lookup. On success, flip status pending→verified
 * and stamp `verifiedAt`. Edge proxy can promote verified→active once
 * the cert is issued (out-of-band; we don't manage certs in this route).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOrgContext, requireTeamsPlus, OrgAuthError } from "@/lib/org-auth";
import { verifyDomainTxt } from "@/lib/dns-verify";
import { invalidateCustomDomain } from "@/lib/custom-domain";
import { recordAudit } from "@/lib/audit";

export async function POST(
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
    if (!row)
      return NextResponse.json(
        { error: "no domain configured" },
        { status: 404 },
      );

    const result = await verifyDomainTxt(row.hostname, row.verifyToken);
    const now = new Date();
    if (result.ok) {
      await prisma.orgDomain.update({
        where: { id: row.id },
        data: {
          status: row.status === "active" ? "active" : "verified",
          verifiedAt: row.verifiedAt ?? now,
          lastCheckedAt: now,
          lastError: null,
        },
      });
      invalidateCustomDomain(row.hostname);
      await recordAudit({
        action: "org.update",
        target: row.hostname,
        actorUserId: ctx.user.id,
        orgId: ctx.org.id,
        metadata: { domain: row.hostname, status: "verified" },
      });
      return NextResponse.json({
        ok: true,
        status: "verified",
        observed: result.observed,
      });
    }
    await prisma.orgDomain.update({
      where: { id: row.id },
      data: {
        status: "failed",
        lastCheckedAt: now,
        lastError: result.error ?? "unknown",
      },
    });
    invalidateCustomDomain(row.hostname);
    return NextResponse.json(
      { ok: false, error: result.error, observed: result.observed },
      { status: 400 },
    );
  } catch (e) {
    const err = e as OrgAuthError;
    if (err && typeof err.status === "number") {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[org/domain/verify]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
