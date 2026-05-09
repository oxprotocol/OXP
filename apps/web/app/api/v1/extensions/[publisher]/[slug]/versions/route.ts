/**
 * GET  /api/v1/extensions/{publisher}/{slug}/versions
 *   → { extensionId, latest, versions: [{ semver, publishedAt,
 *       bundleSize, yankedAt? }] }  — newest first.
 *
 *   Public. No auth. Used by the package detail page and by clients
 *   showing version history.
 *
 * POST /api/v1/extensions/{publisher}/{slug}/versions
 *
 * Multipart upload — fields:
 *   - bundle:    application/vnd.oxp.bundle.v1.tar+zstd  (required)
 *   - signature: application/json  (Ed25519Signature)    (required)
 *   - publicKey: text/plain        (PEM-encoded)         (required)
 *
 * Auth: Bearer API token with `publish` scope.
 *
 * The {publisher}/{slug} path segments are informational; the authoritative
 * values come from the manifest inside the bundle. Mismatches are rejected.
 */

import { NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";
import { canPublish } from "@/lib/token-scopes";
import { publishVersion } from "@/lib/publish";
import { prisma } from "@/lib/prisma";
import { consume, LIMITS, rateLimitHeaders } from "@/lib/rate-limit";
import { tokenSatisfies2faGate } from "@/lib/two-factor";
import type { Ed25519Signature } from "@oxprotocol/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ publisher: string; slug: string }> },
): Promise<Response> {
  const { publisher, slug } = await ctx.params;
  const ext = await prisma.extension.findUnique({
    where: { ownerHandle_slug: { ownerHandle: publisher, slug } },
    select: { id: true, latestVersion: true },
  });
  if (!ext) {
    return NextResponse.json(
      { ok: false, error: "extension not found" },
      { status: 404 },
    );
  }
  const rows = await prisma.version.findMany({
    where: { extensionId: ext.id },
    orderBy: { publishedAt: "desc" },
    select: {
      semver: true,
      publishedAt: true,
      bundleSize: true,
      yankedAt: true,
    },
  });
  return NextResponse.json(
    {
      extensionId: ext.id,
      latest: ext.latestVersion,
      versions: rows.map((r) => ({
        semver: r.semver,
        publishedAt: r.publishedAt.toISOString(),
        bundleSize: Number(r.bundleSize),
        yankedAt: r.yankedAt?.toISOString() ?? null,
      })),
    },
    {
      headers: {
        "cache-control":
          "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ publisher: string; slug: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth.ok) return jsonError(auth.status, auth.error);

  // Phase B.6 — per-token publish rate limit. Consume BEFORE parsing the
  // body so a hammering client cannot DoS the multipart parser.
  const rl = consume(
    `publish:${auth.auth.token.id}`,
    LIMITS.publish.limit,
    LIMITS.publish.windowMs,
  );
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `publish rate limit exceeded — try again in ${Math.ceil(
          rl.retryAfterMs / 1000,
        )}s`,
      },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  // Phase B.7 — if the user has TOTP 2FA enrolled, the token must carry a
  // recent (≤ 10 min) two-factor proof. Tokens whose owner hasn't enrolled
  // bypass this gate (opt-in security). Returns 428 + WWW-Authenticate so
  // the CLI can prompt for a code and retry.
  const gate = tokenSatisfies2faGate(auth.auth.user, auth.auth.token);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.reason ?? "two-factor proof required" },
      {
        status: 428,
        headers: {
          "www-authenticate": 'TwoFactor realm="oxp", scope="publish"',
        },
      },
    );
  }

  const params = await ctx.params;

  // Phase A.8 — token must be scoped to this exact package or its
  // namespace. We check BEFORE parsing the multipart body so a
  // mis-scoped publisher gets a 403 without us hashing 64 MiB.
  const targetId = `@${params.publisher}/${params.slug}`;
  if (!canPublish(auth.auth.token.scopes, targetId)) {
    return jsonError(
      403,
      `token not scoped to publish ${targetId} (scopes: ${auth.auth.token.scopes.join(", ") || "<none>"})`,
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return jsonError(400, `invalid multipart body: ${(e as Error).message}`);
  }

  const bundleField = form.get("bundle");
  const signatureField = form.get("signature");
  const publicKeyField = form.get("publicKey");

  if (!(bundleField instanceof File))
    return jsonError(400, "missing 'bundle' file");
  if (typeof signatureField !== "string")
    return jsonError(400, "missing 'signature' string");
  if (typeof publicKeyField !== "string")
    return jsonError(400, "missing 'publicKey' string");

  if (bundleField.size > MAX_BUNDLE_BYTES) {
    return jsonError(413, `bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
  }

  let signature: Ed25519Signature;
  try {
    signature = JSON.parse(signatureField) as Ed25519Signature;
  } catch {
    return jsonError(400, "signature is not valid JSON");
  }
  if (signature.alg !== "ed25519" || typeof signature.signature !== "string") {
    return jsonError(400, "signature must be an Ed25519Signature object");
  }

  const oxp = Buffer.from(await bundleField.arrayBuffer());

  // Phase B.5 — optional in-toto / DSSE attestation envelope. Stored
  // verbatim; signature verification against sigstore is deferred to B.5b.
  let attestation: unknown;
  const attestationField = form.get("attestation");
  if (typeof attestationField === "string" && attestationField.trim()) {
    try {
      attestation = JSON.parse(attestationField);
    } catch {
      return jsonError(400, "attestation is not valid JSON");
    }
  }

  // Phase B.5b — optional Sigstore keyless signature bundle. When present,
  // the registry cryptographically verifies the cert chain + Rekor inclusion
  // proof and persists the signer identity for public auditability.
  let sigstoreBundle: unknown;
  const sigstoreField = form.get("sigstoreBundle");
  if (typeof sigstoreField === "string" && sigstoreField.trim()) {
    try {
      sigstoreBundle = JSON.parse(sigstoreField);
    } catch {
      return jsonError(400, "sigstoreBundle is not valid JSON");
    }
  }

  const result = await publishVersion({
    user: auth.auth.user,
    oxp,
    signature,
    publicKeyPem: publicKeyField,
    attestation,
    sigstoreBundle: sigstoreBundle as never,
  });

  if (!result.ok) return jsonError(result.status, result.error);

  // Sanity: path params must match the manifest's identity
  if (
    params.publisher !== result.manifest.publisher ||
    params.slug !== result.manifest.id.split("/")[1]
  ) {
    return jsonError(
      422,
      `path /${params.publisher}/${params.slug} does not match manifest ${result.manifest.id}`,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      extensionId: result.extensionId,
      versionId: result.versionId,
      id: result.manifest.id,
      version: result.semver,
      bundleSha256: result.manifest.integrity?.bundleSha256 ?? null,
    },
    { status: 201 },
  );
}

function jsonError(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status });
}
