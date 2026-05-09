/**
 * BYO object-storage backend (Enterprise). S3 / R2 / MinIO are real;
 * Azure Blob and GCS return 501 from the runtime helper.
 *
 * GET    → masked config
 * PUT    → upsert + smoke test (PUT/GET/DELETE a small probe object)
 * DELETE
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  loadOrgContext,
  requireEnterprise,
  OrgAuthError,
} from "@/lib/org-auth";
import { encryptSecret, maskSecret } from "@/lib/crypto-envelope";
import { backendSmokeTest } from "@/lib/storage-backend";
import type { OrgStorageBackend, StorageProvider } from "@prisma/client";

const PROVIDERS: StorageProvider[] = ["s3", "r2", "azure_blob", "gcs", "minio"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const ctx = await loadOrgContext(handle);
    requireEnterprise(ctx);
    const row = await prisma.orgStorageBackend.findUnique({
      where: { orgId: ctx.org.id },
    });
    if (!row) return NextResponse.json({ storage: null });
    return NextResponse.json({ storage: maskRow(row) });
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
    const provider = String(body.provider ?? "") as StorageProvider;
    if (!PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: `provider must be one of ${PROVIDERS.join(", ")}` },
        { status: 400 },
      );
    }
    const bucket = String(body.bucket ?? "").trim();
    const region = String(body.region ?? "").trim();
    const endpoint = body.endpoint ? String(body.endpoint).trim() : "";
    const accessKeyId = String(body.accessKeyId ?? "").trim();
    const secret = String(body.secret ?? "");
    const sseKmsKeyId = body.sseKmsKeyId
      ? String(body.sseKmsKeyId).trim()
      : null;
    const prefix =
      String(body.prefix ?? "oxp/").replace(/^\/+|\/+$/g, "") + "/";

    if (!bucket)
      return NextResponse.json({ error: "bucket required" }, { status: 400 });
    if (provider === "s3" && !region)
      return NextResponse.json(
        { error: "region required for s3" },
        { status: 400 },
      );
    if (!accessKeyId)
      return NextResponse.json(
        { error: "accessKeyId required" },
        { status: 400 },
      );

    const existing = await prisma.orgStorageBackend.findUnique({
      where: { orgId: ctx.org.id },
    });
    const secretEnc = secret
      ? encryptSecret(secret)
      : (existing?.secretEnc ?? "");
    if (!secretEnc)
      return NextResponse.json({ error: "secret required" }, { status: 400 });

    const draft: OrgStorageBackend = {
      id: existing?.id ?? "draft",
      orgId: ctx.org.id,
      provider,
      bucket,
      region,
      endpoint,
      accessKeyId,
      secretEnc,
      sseKmsKeyId,
      prefix,
      lastHealthAt: null,
      lastError: null,
      enabledAt: existing?.enabledAt ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    const error = await backendSmokeTest(draft);
    if (error) {
      return NextResponse.json(
        { error: `smoke test failed: ${error}` },
        { status: 400 },
      );
    }
    const now = new Date();
    const row = await prisma.orgStorageBackend.upsert({
      where: { orgId: ctx.org.id },
      create: {
        orgId: ctx.org.id,
        provider,
        bucket,
        region,
        endpoint,
        accessKeyId,
        secretEnc,
        sseKmsKeyId,
        prefix,
        lastHealthAt: now,
        enabledAt: now,
      },
      update: {
        provider,
        bucket,
        region,
        endpoint,
        accessKeyId,
        secretEnc,
        sseKmsKeyId,
        prefix,
        lastHealthAt: now,
        lastError: null,
        enabledAt: existing?.enabledAt ?? now,
      },
    });
    return NextResponse.json({ storage: maskRow(row) });
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
    await prisma.orgStorageBackend.deleteMany({ where: { orgId: ctx.org.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

function maskRow(row: OrgStorageBackend) {
  return {
    provider: row.provider,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    accessKeyId: maskSecret(row.accessKeyId),
    sseKmsKeyId: row.sseKmsKeyId,
    prefix: row.prefix,
    lastHealthAt: row.lastHealthAt,
    lastError: row.lastError,
    enabledAt: row.enabledAt,
  };
}

function errorResponse(e: unknown): Response {
  const err = e as OrgAuthError;
  if (err && typeof err.status === "number") {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[org/storage]", e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
