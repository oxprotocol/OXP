/**
 * KMS-backed signing key (Enterprise). AWS KMS works end-to-end; other
 * providers throw 501 from the runtime helper.
 *
 *  PUT body:
 *    { provider:"aws_kms", region, keyRef, algorithm,
 *      credentials: { accessKeyId, secretAccessKey, sessionToken? } }
 *
 *  We call KMS:GetPublicKey as a smoke test, cache the SPKI PEM, and
 *  flip enabledAt.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  loadOrgContext,
  requireEnterprise,
  OrgAuthError,
} from "@/lib/org-auth";
import { encryptSecret } from "@/lib/crypto-envelope";
import { fetchPublicKey, encodeAwsCreds } from "@/lib/kms";
import type { OrgKmsKey, KmsProvider } from "@prisma/client";

type KmsAlgorithm = "rsa_pss_sha256" | "ecdsa_p256_sha256";

const PROVIDERS: KmsProvider[] = [
  "aws_kms",
  "gcp_kms",
  "azure_kv",
  "hashicorp_vault",
];
const ALGOS: KmsAlgorithm[] = ["rsa_pss_sha256", "ecdsa_p256_sha256"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireEnterprise(ctx);
    const row = await prisma.orgKmsKey.findUnique({
      where: { orgId: ctx.org.id },
    });
    if (!row) return NextResponse.json({ kms: null });
    return NextResponse.json({ kms: maskRow(row) });
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
    requireEnterprise(ctx);
    const body = (await req.json()) as Record<string, unknown>;
    const provider = String(body.provider ?? "") as KmsProvider;
    const algorithm = String(
      body.algorithm ?? "ecdsa_p256_sha256",
    ) as KmsAlgorithm;
    if (!PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: `provider must be one of ${PROVIDERS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!ALGOS.includes(algorithm)) {
      return NextResponse.json(
        { error: `algorithm must be one of ${ALGOS.join(", ")}` },
        { status: 400 },
      );
    }
    const region = String(body.region ?? "").trim();
    const keyRef = String(body.keyRef ?? "").trim();
    if (!keyRef)
      return NextResponse.json({ error: "keyRef required" }, { status: 400 });
    if (provider === "aws_kms" && !region) {
      return NextResponse.json(
        { error: "region required for aws_kms" },
        { status: 400 },
      );
    }

    const existing = await prisma.orgKmsKey.findUnique({
      where: { orgId: ctx.org.id },
    });

    let credentialsEnc = existing?.credentialsEnc ?? "";
    if (provider === "aws_kms") {
      const c = body.credentials as Record<string, unknown> | undefined;
      if (c && c.accessKeyId && c.secretAccessKey) {
        credentialsEnc = encryptSecret(
          encodeAwsCreds({
            accessKeyId: String(c.accessKeyId),
            secretAccessKey: String(c.secretAccessKey),
            sessionToken: c.sessionToken ? String(c.sessionToken) : undefined,
          }),
        );
      }
      if (!credentialsEnc) {
        return NextResponse.json(
          { error: "credentials.{accessKeyId,secretAccessKey} required" },
          { status: 400 },
        );
      }
    }

    const draft: OrgKmsKey = {
      id: existing?.id ?? "draft",
      orgId: ctx.org.id,
      provider,
      keyRef,
      region,
      algorithm,
      credentialsEnc,
      publicKeyPem: existing?.publicKeyPem ?? "",
      rekorUuid: existing?.rekorUuid ?? null,
      lastSignAt: existing?.lastSignAt ?? null,
      lastError: null,
      enabledAt: existing?.enabledAt ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    let publicKeyPem: string;
    try {
      publicKeyPem = await fetchPublicKey(draft);
    } catch (e) {
      const err = e as Error;
      return NextResponse.json(
        { error: `KMS GetPublicKey failed: ${err.message}` },
        { status: 400 },
      );
    }

    const now = new Date();
    const row = await prisma.orgKmsKey.upsert({
      where: { orgId: ctx.org.id },
      create: {
        orgId: ctx.org.id,
        provider,
        keyRef,
        region,
        algorithm,
        credentialsEnc,
        publicKeyPem,
        enabledAt: now,
      },
      update: {
        provider,
        keyRef,
        region,
        algorithm,
        credentialsEnc,
        publicKeyPem,
        lastError: null,
        enabledAt: existing?.enabledAt ?? now,
      },
    });
    return NextResponse.json({ kms: maskRow(row) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireEnterprise(ctx);
    await prisma.orgKmsKey.deleteMany({ where: { orgId: ctx.org.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

function maskRow(row: OrgKmsKey) {
  return {
    provider: row.provider,
    keyRef: row.keyRef,
    region: row.region,
    algorithm: row.algorithm,
    publicKeyPem: row.publicKeyPem,
    lastSignAt: row.lastSignAt,
    lastError: row.lastError,
    enabledAt: row.enabledAt,
  };
}

function errorResponse(e: unknown): Response {
  const err = e as OrgAuthError;
  if (err && typeof err.status === "number") {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[org/kms]", e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
