/**
 * AWS KMS adapter — Sign / GetPublicKey via SigV4-signed JSON RPC.
 *
 * KMS is asymmetric here: customer holds the key, we never see private
 * material. We POST to `kms.<region>.amazonaws.com` with header
 * `X-Amz-Target: TrentService.<Op>` per the KMS data plane.
 *
 * Other providers (GCP KMS, Azure Key Vault, Vault Transit) follow the
 * same shape but with their own auth. Stubbed today; rows are accepted
 * but `signWithOrgKey` throws `provider not implemented`.
 */

import type { OrgKmsKey } from "@prisma/client";
import { decryptSecret } from "./crypto-envelope";
import { signV4 } from "./sigv4";

export class KmsError extends Error {
  status: number;
  constructor(msg: string, status = 500) {
    super(msg);
    this.status = status;
  }
}

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function awsCredsFor(key: OrgKmsKey): AwsCreds {
  // credentialsEnc encodes JSON {accessKeyId, secretAccessKey, sessionToken?}
  if (!key.credentialsEnc) {
    throw new KmsError(
      "KMS credentials missing (workload-identity not yet supported)",
      400,
    );
  }
  const json = decryptSecret(key.credentialsEnc);
  const obj = JSON.parse(json) as AwsCreds;
  if (!obj.accessKeyId || !obj.secretAccessKey) {
    throw new KmsError("KMS credentials malformed", 400);
  }
  return obj;
}

function awsAlgorithm(alg: string): string {
  switch (alg) {
    case "rsa_pss_sha256":
      return "RSASSA_PSS_SHA_256";
    case "ecdsa_p256_sha256":
      return "ECDSA_SHA_256";
    default:
      throw new KmsError(`unsupported algorithm: ${alg}`, 400);
  }
}

async function awsKmsCall(
  region: string,
  creds: AwsCreds,
  target: string,
  body: object,
): Promise<unknown> {
  const host = `kms.${region}.amazonaws.com`;
  const json = JSON.stringify(body);
  const signed = signV4({
    method: "POST",
    service: "kms",
    region,
    host,
    path: "/",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `TrentService.${target}`,
    },
    body: Buffer.from(json),
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
  });
  const res = await fetch(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: json,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new KmsError(
      `KMS ${target} ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Sign a message with the org's KMS key. Returns the raw signature bytes.
 * The caller is responsible for the wire format (Sigstore expects a
 * specific encoding for the corresponding x509 / Rekor entry).
 */
export async function signWithOrgKey(
  key: OrgKmsKey,
  message: Buffer,
): Promise<Buffer> {
  if (key.provider !== "aws_kms") {
    throw new KmsError(`provider ${key.provider} not yet implemented`, 501);
  }
  const creds = awsCredsFor(key);
  const result = (await awsKmsCall(key.region || "us-east-1", creds, "Sign", {
    KeyId: key.keyRef,
    Message: message.toString("base64"),
    MessageType: "RAW",
    SigningAlgorithm: awsAlgorithm(key.algorithm),
  })) as { Signature: string };
  if (!result.Signature) throw new KmsError("KMS Sign returned no Signature");
  return Buffer.from(result.Signature, "base64");
}

/** Returns PEM-encoded SubjectPublicKeyInfo. Cached on the row after first call. */
export async function fetchPublicKey(key: OrgKmsKey): Promise<string> {
  if (key.provider !== "aws_kms") {
    throw new KmsError(`provider ${key.provider} not yet implemented`, 501);
  }
  const creds = awsCredsFor(key);
  const result = (await awsKmsCall(
    key.region || "us-east-1",
    creds,
    "GetPublicKey",
    {
      KeyId: key.keyRef,
    },
  )) as { PublicKey: string };
  if (!result.PublicKey)
    throw new KmsError("KMS GetPublicKey returned no PublicKey");
  // PublicKey is base64 DER (SPKI). Wrap to PEM.
  const der = result.PublicKey;
  const lines = der.match(/.{1,64}/g)?.join("\n") ?? der;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

/** Lightweight liveness probe: GetPublicKey only (no charge for sign). */
export async function kmsSmokeTest(key: OrgKmsKey): Promise<string | null> {
  try {
    const pem = await fetchPublicKey(key);
    if (!pem.includes("BEGIN PUBLIC KEY")) return "unexpected response";
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Encode AWS access keys for storage in `OrgKmsKey.credentialsEnc`.
 * Helper for the admin UI.
 */
export function encodeAwsCreds(c: AwsCreds): string {
  return JSON.stringify(c);
}
