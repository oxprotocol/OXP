/**
 * GET /api/v1/extensions/{publisher}/{slug}/versions/{semver}/bundle
 *   → application/vnd.oxp.bundle.v1.tar+zstd — the .oxp bytes
 *
 * Public. No auth. Long-cacheable (immutable per (extension, semver)).
 *
 * Phase 1 — every served byte is metered against the publisher's monthly
 * bandwidth quota (`PLANS[plan].limits.cdnBandwidthGb`). Once the cap is
 * breached the endpoint returns 402 Payment Required until the next UTC
 * month or the publisher upgrades their plan.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBundle } from "@/lib/blob-store";
import { getSubjectPlan } from "@/lib/billing";
import { assertBandwidthAvailable, incrementBandwidth } from "@/lib/bandwidth";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ publisher: string; slug: string; semver: string }> },
): Promise<Response> {
  const { publisher, slug, semver } = await ctx.params;
  const ext = await prisma.extension.findUnique({
    where: { ownerHandle_slug: { ownerHandle: publisher, slug } },
    select: { id: true, ownerKind: true, ownerId: true, ownerHandle: true },
  });
  if (!ext)
    return NextResponse.json(
      { ok: false, error: "extension not found" },
      { status: 404 },
    );

  const v = await prisma.version.findUnique({
    where: { extensionId_semver: { extensionId: ext.id, semver } },
    select: {
      bundleSha256: true,
      bundleSize: true,
      bundleMimeType: true,
      yankedAt: true,
    },
  });
  if (!v)
    return NextResponse.json(
      { ok: false, error: "version not found" },
      { status: 404 },
    );
  if (v.yankedAt)
    return NextResponse.json(
      { ok: false, error: "version yanked" },
      { status: 410 },
    );

  // Bandwidth gate — 402 if the publisher already exceeded their cap.
  const subjectKind = ext.ownerKind === "org" ? "org" : "user";
  const plan = await getSubjectPlan(subjectKind, ext.ownerId);
  const check = await assertBandwidthAvailable(
    { kind: ext.ownerKind, id: ext.ownerId },
    plan,
  );
  if (!check.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "bandwidth_quota_exceeded",
        message:
          `@${ext.ownerHandle} has exceeded the ${check.capGb} GB / month ` +
          `CDN cap on the ${plan} plan. Quota resets at the start of the ` +
          `next UTC month, or the publisher can upgrade at /pricing.`,
        plan,
        capGb: check.capGb,
        usedBytes: Number(check.used),
      },
      {
        status: 402,
        headers: {
          "x-oxp-plan": plan,
          "x-oxp-bandwidth-cap-gb": String(check.capGb),
        },
      },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await getBundle(v.bundleSha256);
  } catch {
    return NextResponse.json(
      { ok: false, error: "blob missing" },
      { status: 500 },
    );
  }

  // Charge served bytes to the publisher. Best-effort — metering failures
  // must NOT break the download.
  void incrementBandwidth(
    { kind: ext.ownerKind, id: ext.ownerId },
    Number(v.bundleSize),
  ).catch(() => {});

  // Convert to a Uint8Array view to satisfy the BodyInit type in NextResponse
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": v.bundleMimeType,
      "content-length": String(v.bundleSize),
      "x-oxp-bundle-sha256": v.bundleSha256,
      "x-oxp-plan": plan,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
