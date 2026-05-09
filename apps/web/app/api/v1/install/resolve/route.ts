/**
 * GET /api/v1/install/resolve?id=@publisher/slug&range=^1.0.0
 *   → { id, version, bundleUrl, manifestUrl, signatureUrl, bundleSha256, signatureKeyId }
 *
 * Picks the highest published, non-yanked version satisfying `range`.
 * Range syntax (MVP): exact "1.2.3", caret "^1.2.3", tilde "~1.2.3", or "*".
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const range = url.searchParams.get("range") ?? "*";

  if (!id)
    return NextResponse.json(
      { ok: false, error: "missing 'id' query parameter" },
      { status: 400 },
    );

  const m = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(id);
  if (!m)
    return NextResponse.json(
      { ok: false, error: "invalid id" },
      { status: 400 },
    );
  const [, publisher, slug] = m;

  const ext = await prisma.extension.findUnique({
    where: { ownerHandle_slug: { ownerHandle: publisher!, slug: slug! } },
    select: { id: true },
  });
  if (!ext)
    return NextResponse.json(
      { ok: false, error: "extension not found" },
      { status: 404 },
    );

  const versions = await prisma.version.findMany({
    where: { extensionId: ext.id, yankedAt: null },
    select: {
      semver: true,
      bundleSha256: true,
      signatureKeyId: true,
    },
  });
  if (versions.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no published versions" },
      { status: 404 },
    );
  }

  const matches = versions
    .filter((v) => satisfies(v.semver, range))
    .sort((a, b) => -semverCompare(a.semver, b.semver));
  const best = matches[0];
  if (!best) {
    return NextResponse.json(
      { ok: false, error: `no version of ${id} satisfies '${range}'` },
      { status: 404 },
    );
  }

  const base = `${url.origin}/api/v1/extensions/${publisher}/${slug}/versions/${best.semver}`;
  return NextResponse.json({
    ok: true,
    id,
    version: best.semver,
    bundleSha256: best.bundleSha256,
    signatureKeyId: best.signatureKeyId,
    manifestUrl: `${base}/manifest`,
    bundleUrl: `${base}/bundle`,
    signatureUrl: `${base}/signature`,
  });
}

// ──────────────────────────────────────────────────────────────────────
// minimal semver matcher
// ──────────────────────────────────────────────────────────────────────

function parse(
  v: string,
): { parts: [number, number, number]; pre: string } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" };
}

function semverCompare(a: string, b: string): number {
  const pa = parse(a)!;
  const pb = parse(b)!;
  for (let i = 0; i < 3; i++)
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i]! - pb.parts[i]!;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

function satisfies(version: string, range: string): boolean {
  if (range === "*" || range === "") return true;
  const v = parse(version);
  if (!v) return false;

  if (range.startsWith("^")) {
    const r = parse(range.slice(1));
    if (!r) return false;
    if (r.parts[0] > 0)
      return (
        v.parts[0] === r.parts[0] && semverCompare(version, range.slice(1)) >= 0
      );
    if (r.parts[1] > 0)
      return (
        v.parts[0] === 0 &&
        v.parts[1] === r.parts[1] &&
        semverCompare(version, range.slice(1)) >= 0
      );
    return v.parts[0] === 0 && v.parts[1] === 0 && v.parts[2] === r.parts[2];
  }
  if (range.startsWith("~")) {
    const r = parse(range.slice(1));
    if (!r) return false;
    return (
      v.parts[0] === r.parts[0] &&
      v.parts[1] === r.parts[1] &&
      semverCompare(version, range.slice(1)) >= 0
    );
  }
  // Exact match
  return version === range;
}
