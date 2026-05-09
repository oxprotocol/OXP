/**
 * Envelope encryption for at-rest secrets (SSO client secrets, BYO storage
 * credentials, KMS provider creds).
 *
 * AES-256-GCM with a master key from `OXP_DATA_KEY` (32 random bytes,
 * base64). Each ciphertext has its own 96-bit IV. Format on disk:
 *
 *     v1:<base64-iv>:<base64-ciphertext-with-auth-tag>
 *
 * The master key can be rotated by re-encrypting all rows; the `v1:`
 * prefix is reserved so future rotations can switch to `v2:` without a
 * destructive migration.
 *
 * In production the master key should be wrapped by a real KMS (AWS/GCP)
 * — but the at-rest format here is what gets stored either way.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function masterKey(): Buffer {
  const b64 = process.env.OXP_DATA_KEY;
  if (!b64) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "OXP_DATA_KEY is required in production (32 random bytes, base64).",
      );
    }
    // Dev-only: deterministic key so existing rows stay readable across
    // restarts. NEVER use this in production.
    return Buffer.alloc(32, 7);
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) {
    throw new Error("OXP_DATA_KEY must decode to 32 bytes");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${Buffer.concat([ct, tag]).toString("base64")}`;
}

export function decryptSecret(envelope: string): string {
  if (!envelope) return "";
  const parts = envelope.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("crypto-envelope: unsupported version");
  }
  const iv = Buffer.from(parts[1], "base64");
  const blob = Buffer.from(parts[2], "base64");
  if (blob.length < 16)
    throw new Error("crypto-envelope: ciphertext too short");
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}

/** Mask a secret for display: last 4 chars only. */
export function maskSecret(s: string): string {
  if (!s) return "";
  if (s.length <= 4) return "•".repeat(s.length);
  return "•".repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}
