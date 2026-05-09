/**
 * Pluggable object storage backend for bundle blobs.
 *
 * The default backend is the local filesystem (lib/blob-store.ts). When an
 * org configures a `OrgStorageBackend` row, all reads/writes for that org's
 * extensions are served from the customer's bucket. We keep the same
 * content-addressed layout: <prefix>/<sha[0..2]>/<sha[2..4]>/<sha>.oxp.
 *
 * Provider support:
 *   - s3, r2, minio  — AWS S3 REST API + SigV4 (this file)
 *   - azure_blob     — Azure Blob REST + SAS or shared-key (TODO: not in
 *                      the v0.2 ship; row accepted, smoke test fails)
 *   - gcs            — XML API + HMAC SigV2 (TODO same)
 *
 * The S3 path is fully implemented — that's the 90 % case (R2, MinIO,
 * Wasabi, B2 all expose it).
 */

import type { OrgStorageBackend } from "@prisma/client";
import { decryptSecret } from "./crypto-envelope";
import { signV4 } from "./sigv4";

export class StorageBackendError extends Error {
  status: number;
  constructor(msg: string, status = 500) {
    super(msg);
    this.status = status;
  }
}

function objectKey(prefix: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new StorageBackendError(`invalid sha256: ${sha256}`, 400);
  }
  const p = prefix.replace(/^\/+|\/+$/g, "");
  const head = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.oxp`;
  return p ? `${p}/${head}` : head;
}

function s3Host(b: OrgStorageBackend): string {
  if (b.endpoint) {
    // R2/MinIO: endpoint already includes scheme; strip and use vhost-style
    // bucket prefix.
    const u = new URL(b.endpoint);
    return `${b.bucket}.${u.host}`;
  }
  // Native AWS S3 virtual-hosted-style.
  return `${b.bucket}.s3.${b.region || "us-east-1"}.amazonaws.com`;
}

function isS3Compatible(provider: string): boolean {
  return provider === "s3" || provider === "r2" || provider === "minio";
}

export async function backendPut(
  backend: OrgStorageBackend,
  sha256: string,
  body: Buffer,
): Promise<void> {
  if (!isS3Compatible(backend.provider)) {
    throw new StorageBackendError(
      `provider ${backend.provider} not yet implemented`,
      501,
    );
  }
  const host = s3Host(backend);
  const key = objectKey(backend.prefix, sha256);
  const region = backend.region || "auto";
  const secret = decryptSecret(backend.secretEnc);
  const signed = signV4({
    method: "PUT",
    service: "s3",
    region,
    host,
    path: "/" + key,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
      ...(backend.sseKmsKeyId
        ? {
            "x-amz-server-side-encryption": "aws:kms",
            "x-amz-server-side-encryption-aws-kms-key-id": backend.sseKmsKeyId,
          }
        : {}),
    },
    body,
    accessKeyId: backend.accessKeyId,
    secretAccessKey: secret,
  });
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new StorageBackendError(
      `S3 PUT ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }
}

export async function backendGet(
  backend: OrgStorageBackend,
  sha256: string,
): Promise<Buffer> {
  if (!isS3Compatible(backend.provider)) {
    throw new StorageBackendError(
      `provider ${backend.provider} not yet implemented`,
      501,
    );
  }
  const host = s3Host(backend);
  const key = objectKey(backend.prefix, sha256);
  const region = backend.region || "auto";
  const secret = decryptSecret(backend.secretEnc);
  const signed = signV4({
    method: "GET",
    service: "s3",
    region,
    host,
    path: "/" + key,
    accessKeyId: backend.accessKeyId,
    secretAccessKey: secret,
  });
  const res = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new StorageBackendError(
      `S3 GET ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function backendHas(
  backend: OrgStorageBackend,
  sha256: string,
): Promise<boolean> {
  if (!isS3Compatible(backend.provider)) return false;
  const host = s3Host(backend);
  const key = objectKey(backend.prefix, sha256);
  const region = backend.region || "auto";
  const secret = decryptSecret(backend.secretEnc);
  const signed = signV4({
    method: "HEAD",
    service: "s3",
    region,
    host,
    path: "/" + key,
    accessKeyId: backend.accessKeyId,
    secretAccessKey: secret,
  });
  const res = await fetch(signed.url, {
    method: "HEAD",
    headers: signed.headers,
  });
  return res.ok;
}

/**
 * Smoke test: write a tiny canary, read it back, verify identity. Returns
 * `null` on success or an error message on failure. Used by the admin UI
 * to validate the configuration before flipping `enabledAt`.
 */
export async function backendSmokeTest(
  backend: OrgStorageBackend,
): Promise<string | null> {
  try {
    const canary = Buffer.from(`oxp-canary-${Date.now()}`);
    // Use a deterministic-ish sha256 namespace so we don't pollute the
    // bucket: write under a fixed key not in the content-addressed tree.
    const host = s3Host(backend);
    const key =
      `${backend.prefix.replace(/^\/+|\/+$/g, "")}/_canary/probe.bin`.replace(
        /^\/+/,
        "",
      );
    const region = backend.region || "auto";
    const secret = decryptSecret(backend.secretEnc);

    const put = signV4({
      method: "PUT",
      service: "s3",
      region,
      host,
      path: "/" + key,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(canary.length),
      },
      body: canary,
      accessKeyId: backend.accessKeyId,
      secretAccessKey: secret,
    });
    const putRes = await fetch(put.url, {
      method: "PUT",
      headers: put.headers,
      body: canary,
    });
    if (!putRes.ok) {
      return `PUT ${putRes.status}: ${(await putRes.text()).slice(0, 200)}`;
    }

    const get = signV4({
      method: "GET",
      service: "s3",
      region,
      host,
      path: "/" + key,
      accessKeyId: backend.accessKeyId,
      secretAccessKey: secret,
    });
    const getRes = await fetch(get.url, {
      method: "GET",
      headers: get.headers,
    });
    if (!getRes.ok) {
      return `GET ${getRes.status}: ${(await getRes.text()).slice(0, 200)}`;
    }
    const got = Buffer.from(await getRes.arrayBuffer());
    if (!got.equals(canary)) return "round-trip mismatch (read != write)";
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
