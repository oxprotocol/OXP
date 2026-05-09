import {
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
  createPrivateKey,
  createHash,
  type KeyObject,
} from "node:crypto";

export interface Ed25519KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface Ed25519Signature {
  alg: "ed25519";
  /** Identifier the registry uses to look up the publisher's pubkey. */
  keyId: string;
  /** base64-encoded raw Ed25519 signature. */
  signature: string;
  payload: {
    /** "sha256:<hex>" of the uncompressed tar stream. */
    digest: string;
    /** ISO 8601 timestamp. */
    signedAt: string;
  };
}

/** Generate a fresh Ed25519 keypair (PEM-encoded). */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}

/** Stable key id for a public key — sha256 of DER bytes, "ed25519:" prefix. */
export function keyIdOf(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  const der = key.export({ type: "spki", format: "der" });
  const hex = createHash("sha256").update(der).digest("hex");
  return `ed25519:0x${hex}`;
}

/** Sign the bundle digest. */
export function signEd25519(
  bundleSha256Hex: string,
  privateKeyPem: string,
  publicKeyPem: string,
): Ed25519Signature {
  const priv: KeyObject = createPrivateKey(privateKeyPem);
  const payload = {
    digest: `sha256:${bundleSha256Hex}`,
    signedAt: new Date().toISOString(),
  };
  const message = Buffer.from(canonicalize(payload), "utf8");
  const sig = sign(null, message, priv);
  return {
    alg: "ed25519",
    keyId: keyIdOf(publicKeyPem),
    signature: sig.toString("base64"),
    payload,
  };
}

/** Verify a signature against a public key. Returns boolean (no throw). */
export function verifyEd25519(
  sig: Ed25519Signature,
  publicKeyPem: string,
): boolean {
  if (sig.alg !== "ed25519") return false;
  if (sig.keyId !== keyIdOf(publicKeyPem)) return false;
  const pub: KeyObject = createPublicKey(publicKeyPem);
  const message = Buffer.from(canonicalize(sig.payload), "utf8");
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(sig.signature, "base64");
  } catch {
    return false;
  }
  return verify(null, message, pub, sigBytes);
}

/** Deterministic JSON: keys sorted, no whitespace. */
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
