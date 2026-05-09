/**
 * AWS Signature V4 — minimal implementation, fetch-friendly, zero deps.
 *
 * Used by:
 *   - lib/storage-backend.ts (S3 / R2 / MinIO via S3 API)
 *   - lib/kms.ts            (AWS KMS Sign / GetPublicKey)
 *
 * Only signs requests with a body buffer (no streaming). That covers our
 * upload-and-sign use cases. References: AWS SigV4 spec §3.
 */

import { createHash, createHmac } from "node:crypto";

export interface SigV4Input {
  method: string; // "GET" | "PUT" | "POST" | "DELETE"
  service: string; // "s3" | "kms"
  region: string;
  host: string;
  path: string; // canonical path, must start with "/"
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Buffer;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** RFC: amz-date is YYYYMMDDTHHMMSSZ. Pass to allow tests; defaults to now. */
  now?: Date;
  /** S3 needs UNSIGNED-PAYLOAD or hex-sha256; KMS needs hex-sha256. */
  unsignedPayload?: boolean;
}

export interface SigV4Output {
  url: string;
  headers: Record<string, string>;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}
function hash(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function uriEncode(s: string, encodeSlash: boolean): string {
  // RFC3986 unreserved + special handling for slash.
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/") out += encodeSlash ? "%2F" : "/";
    else {
      for (const b of Buffer.from(ch, "utf8")) {
        out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

export function signV4(input: SigV4Input): SigV4Output {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const body = input.body ?? Buffer.alloc(0);
  const payloadHash = input.unsignedPayload ? "UNSIGNED-PAYLOAD" : hash(body);

  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...(input.headers ?? {}),
  };
  if (input.sessionToken) headers["x-amz-security-token"] = input.sessionToken;

  // Canonical query: keys URI-encoded, sorted, joined by &.
  const qEntries = Object.entries(input.query ?? {})
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = qEntries.map(([k, v]) => `${k}=${v}`).join("&");

  // Canonical headers: lowercased names, trimmed values, sorted.
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k.toLowerCase(),
      String(v).trim().replace(/\s+/g, " "),
    ]),
  );
  const sortedHeaderKeys = Object.keys(lowered).sort();
  const canonicalHeaders =
    sortedHeaderKeys.map((k) => `${k}:${lowered[k]}`).join("\n") + "\n";
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalPath = input.path
    .split("/")
    .map((seg) => uriEncode(seg, true))
    .join("/");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + input.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url =
    `https://${input.host}${canonicalPath || "/"}` +
    (canonicalQuery ? `?${canonicalQuery}` : "");

  return {
    url,
    headers: {
      ...headers,
      Authorization: authorization,
    },
  };
}
