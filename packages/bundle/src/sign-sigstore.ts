/**
 * Sigstore keyless signing & verification for `.oxp` bundles.
 *
 * Sits alongside the Ed25519 signing layer (`sign-ed25519.ts`):
 *   - Ed25519 is mandatory and works fully offline.
 *   - Sigstore is optional and provides a public, transparency-logged
 *     attestation linking the bundle digest to the publisher's verified
 *     OIDC identity (e.g. `alice@acme.com` via Google, or
 *     `https://github.com/acme/extension/.github/workflows/release.yml@refs/heads/main`
 *     via GitHub Actions).
 *
 * What we sign: the same canonicalized JSON payload as Ed25519
 * (`{ digest: "sha256:<hex>", signedAt }`). This means a Sigstore
 * signature commits to the *bundle*, not just an arbitrary blob, and a
 * verifier can cross-check the Ed25519 keyId against the cert SAN.
 *
 * Public good: the resulting Sigstore bundle (cert + sig + Rekor inclusion
 * proof) is stored verbatim on the registry. Anyone can independently
 * re-verify it offline against Fulcio's published trust root + Rekor's
 * Merkle log without trusting OXP's server.
 */

import {
  sign as sigstoreSign,
  verify as sigstoreVerify,
  type SignOptions,
  type VerifyOptions,
  type Bundle,
} from "sigstore";
import { createHash } from "node:crypto";

/**
 * Opaque Sigstore bundle JSON (https://github.com/sigstore/protobuf-specs).
 * We persist it verbatim so anybody can re-verify without our help.
 */
export type SigstoreBundle = Bundle;

export interface SigstoreSigner {
  /**
   * Path to fetch an OIDC identity token. If omitted, the sigstore lib
   * auto-detects GitHub Actions (`ACTIONS_ID_TOKEN_REQUEST_URL`).
   * Pass an explicit token when running outside CI.
   */
  identityToken?: string;
  /** Defaults to the public Sigstore production instance. */
  fulcioURL?: string;
  /** Defaults to the public Sigstore Rekor instance. */
  rekorURL?: string;
}

export interface SigstoreVerification {
  /** OIDC subject (email, SPIFFE id, or GitHub workflow ref). */
  identity: string;
  /** OIDC issuer URL (e.g. `https://accounts.google.com`). */
  issuer: string;
  /** Rekor transparency log index — anyone can fetch & re-verify. */
  logIndex: string;
  /** Rekor entry uuid. Search at https://search.sigstore.dev/?logIndex=… */
  uuid: string;
  /** Wall-clock time the cert was issued (= signing time, ±skew). */
  signedAt: Date;
}

/**
 * Sign the canonical bundle payload using Sigstore keyless OIDC.
 *
 * Returns the full Sigstore bundle JSON (DSSE envelope OR hashedrekord +
 * Fulcio cert chain + Rekor inclusion proof). Ready to ship to the
 * registry alongside the Ed25519 signature.
 *
 * @throws if no identity token is available and we're not in CI.
 */
export async function signSigstore(
  payloadBytes: Buffer,
  opts: SigstoreSigner = {},
): Promise<SigstoreBundle> {
  const signOpts: SignOptions = {
    fulcioURL: opts.fulcioURL ?? "https://fulcio.sigstore.dev",
    rekorURL: opts.rekorURL ?? "https://rekor.sigstore.dev",
    identityToken: opts.identityToken,
  };
  return sigstoreSign(payloadBytes, signOpts);
}

/**
 * Verify a Sigstore bundle covers `payloadBytes`. Throws on any of:
 *   - signature does not verify against the cert
 *   - cert is not chained to a known Fulcio root
 *   - Rekor inclusion proof is missing or invalid
 *   - cert was not valid at the time of Rekor entry
 *
 * Returns the verified identity + log coordinates so the caller can
 * persist them as searchable columns.
 */
export async function verifySigstore(
  payloadBytes: Buffer,
  bundle: SigstoreBundle,
  opts: VerifyOptions = {},
): Promise<SigstoreVerification> {
  await sigstoreVerify(bundle, payloadBytes, opts);
  return extractVerification(bundle);
}

/**
 * Pull human-readable identity + Rekor coordinates out of an already-trusted
 * bundle. Does NOT re-verify cryptographically. Use after `verifySigstore`.
 */
export function extractVerification(
  bundle: SigstoreBundle,
): SigstoreVerification {
  // Fulcio cert chain is in `verificationMaterial.x509CertificateChain`
  // (older bundles) or `.certificate` (newer bundles).
  const vm = bundle.verificationMaterial;
  if (!vm) throw new Error("sigstore bundle has no verificationMaterial");

  const certBytes = pickLeafCert(vm);
  const cert = parseCertSANAndIssuer(certBytes);

  const tlogEntries = vm.tlogEntries ?? [];
  if (tlogEntries.length === 0) {
    throw new Error("sigstore bundle has no Rekor inclusion proof");
  }
  const tlog = tlogEntries[0]!;
  const logIndex = String(tlog.logIndex);
  // canonicalizedBody is base64-encoded in the serialized bundle. We don't
  // need to decode it for our purposes — we just need a stable identifier
  // for deep-linking to https://search.sigstore.dev. Use the base64 hash
  // as the uuid.
  const uuid = createHash("sha256")
    .update(tlog.canonicalizedBody ?? "")
    .digest("hex");
  // Use the integrated time as signing time. It is the time Rekor accepted
  // the entry, which by Fulcio's policy is within the cert's validity window.
  const integratedTime = Number(tlog.integratedTime ?? 0);
  const signedAt = new Date(integratedTime * 1000);

  return {
    identity: cert.san,
    issuer: cert.issuer,
    logIndex,
    uuid,
    signedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────
// internal helpers
// ──────────────────────────────────────────────────────────────────────

interface VMShape {
  x509CertificateChain?: { certificates?: { rawBytes?: string }[] };
  certificate?: { rawBytes?: string };
  tlogEntries?: {
    logIndex?: string | number | bigint;
    integratedTime?: string | number | bigint;
    canonicalizedBody?: string;
  }[];
}

function pickLeafCert(vm: unknown): Uint8Array {
  const v = vm as VMShape;
  const direct = v.certificate?.rawBytes;
  if (direct && direct.length > 0) return Buffer.from(direct, "base64");
  const chain = v.x509CertificateChain?.certificates ?? [];
  const leaf = chain[0]?.rawBytes;
  if (!leaf || leaf.length === 0) {
    throw new Error("sigstore bundle has no x509 cert");
  }
  return Buffer.from(leaf, "base64");
}

/**
 * Minimal DER walker that extracts the OIDC SAN (rfc822Name or URI) and
 * issuer OIDC URL from a Fulcio short-lived cert. We deliberately avoid
 * pulling a heavy ASN.1 lib — Fulcio certs have a stable, narrow shape.
 */
function parseCertSANAndIssuer(_der: Uint8Array): {
  san: string;
  issuer: string;
} {
  // Lean on Node's native X509Certificate (available since Node 15).
  // It exposes subjectAltName + extensions in PEM-friendly form.
  // Lazy-require to keep this module loadable in non-Node contexts
  // (we only sign/verify in Node anyway).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { X509Certificate } =
    require("node:crypto") as typeof import("node:crypto");
  const pem =
    "-----BEGIN CERTIFICATE-----\n" +
    Buffer.from(_der)
      .toString("base64")
      .replace(/(.{64})/g, "$1\n") +
    "\n-----END CERTIFICATE-----\n";
  const x = new X509Certificate(pem);

  // SAN — Fulcio puts the OIDC subject as either an rfc822Name (email)
  // or a URI (for non-email identities like SPIFFE / GitHub workflows).
  const san =
    (x.subjectAltName ?? "")
      .split(",")
      .map((s) => s.trim())
      .map((s) => s.replace(/^(?:email|URI|DNS):/i, ""))
      .find((s) => s.length > 0) ?? "<unknown>";

  // Issuer — Fulcio embeds the OIDC issuer URL in a custom extension
  // (OID 1.3.6.1.4.1.57264.1.1, deprecated, or 1.3.6.1.4.1.57264.1.8 new).
  // X509Certificate doesn't expose custom OIDs by name, so we scan the raw
  // DER for the OID prefix and read the following PRINTABLESTRING.
  const issuer = readFulcioIssuerOID(_der) ?? "<unknown>";

  return { san, issuer };
}

/**
 * Scan the Fulcio cert DER for the issuer-claim extension. Looks for the
 * old (1.3.6.1.4.1.57264.1.1) and new (1.3.6.1.4.1.57264.1.8) OIDs and
 * returns the printable string value.
 *
 * This is intentionally a hand-rolled scan; we only need to match a fixed
 * OID prefix and read a length-prefixed UTF-8 / printable string. If we
 * ever need more cert fields we should pull in `@peculiar/asn1-x509`.
 */
function readFulcioIssuerOID(der: Uint8Array): string | null {
  // Encoded OIDs (DER OBJECT IDENTIFIER body, without tag/length prefix).
  // 1.3.6.1.4.1.57264.1.1  -> 2B 06 01 04 01 83 BF 30 01 01
  // 1.3.6.1.4.1.57264.1.8  -> 2B 06 01 04 01 83 BF 30 01 08
  const NEEDLES = [
    Uint8Array.from([
      0x2b, 0x06, 0x01, 0x04, 0x01, 0x83, 0xbf, 0x30, 0x01, 0x08,
    ]),
    Uint8Array.from([
      0x2b, 0x06, 0x01, 0x04, 0x01, 0x83, 0xbf, 0x30, 0x01, 0x01,
    ]),
  ];
  for (const needle of NEEDLES) {
    const at = indexOf(der, needle);
    if (at < 0) continue;
    // After the OID body, the X509 ext has: BOOLEAN? + OCTET STRING <bytes>
    // Skip until we find the OCTET STRING tag (0x04) and then read length.
    let i = at + needle.length;
    // Optional critical BOOLEAN (tag 0x01)
    if (der[i] === 0x01 && der[i + 1] === 0x01) i += 3;
    if (der[i] !== 0x04) continue; // expected OCTET STRING
    const len = der[i + 1] ?? 0;
    const start = i + 2;
    const value = der.slice(start, start + len);
    // The new OID wraps a UTF8String: tag 0x0c. The old OID wraps the
    // bytes directly. Try the wrapped-string shape first.
    if (value[0] === 0x0c) {
      const innerLen = value[1] ?? 0;
      return Buffer.from(value.slice(2, 2 + innerLen)).toString("utf8");
    }
    return Buffer.from(value).toString("utf8");
  }
  return null;
}

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Convenience: build the canonical payload bytes the way `signEd25519` does
 * — `{digest, signedAt}` JSON with sorted keys, no whitespace. Sigstore is
 * applied to the same payload so verifiers can correlate the two layers.
 */
export function canonicalPayloadFor(
  bundleSha256Hex: string,
  signedAt: Date,
): Buffer {
  const obj = {
    digest: `sha256:${bundleSha256Hex}`,
    signedAt: signedAt.toISOString(),
  };
  return Buffer.from(canonicalize(obj), "utf8");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

/** Compute sha256 hex of arbitrary bytes — kept here so callers don't need an extra import. */
export function sha256Hex(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}
