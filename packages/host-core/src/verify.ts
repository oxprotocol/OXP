import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { decompress } from "fzstd";
import { extract } from "tar-stream";
import {
  type ManifestCommon,
  type PublisherKeysResponse,
  type ResolveResponse,
  type SignatureFile,
  type VerifiedBundle,
  VerifyError,
} from "./types.js";
import { assertHostWitPin } from "./wit-pin.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(
  url: string,
): Promise<{ bytes: Uint8Array; headers: Headers }> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new VerifyError(`fetch ${url} → ${r.status}`, "FETCH_FAILED");
  }
  return { bytes: new Uint8Array(await r.arrayBuffer()), headers: r.headers };
}

async function readTar(tar: Uint8Array): Promise<Map<string, Uint8Array>> {
  return await new Promise((resolve, reject) => {
    const files = new Map<string, Uint8Array>();
    const ex = extract();
    ex.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        if (header.type === "file") {
          files.set(header.name, new Uint8Array(Buffer.concat(chunks)));
        }
        next();
      });
      stream.on("error", reject);
      stream.resume();
    });
    ex.on("finish", () => resolve(files));
    ex.on("error", reject);
    Readable.from(Buffer.from(tar)).pipe(ex);
  });
}

export interface ResolveAndVerifyOptions {
  /**
   * Override the default fetch (e.g. to inject auth headers, custom timeouts,
   * or a node-undici dispatcher). Defaults to globalThis.fetch.
   */
  fetch?: typeof fetch;
}

/**
 * Resolve → download → verify Ed25519 signature → unpack tar.
 *
 * This is the canonical OXP install verification pipeline. The same code
 * runs in the VS Code host, the Piye host, the CLI's `oxp install`, and
 * the reference client. Do NOT fork.
 */
export async function resolveAndVerify(
  registry: string,
  id: string,
  opts: ResolveAndVerifyOptions = {},
): Promise<VerifiedBundle> {
  const f = opts.fetch ?? fetch;

  if (!/^@[^/]+\/[^/]+$/.test(id)) {
    throw new VerifyError(`bad id: ${id}`, "BAD_ID");
  }
  const [publisherWithAt, slug] = id.split("/");
  const publisher = publisherWithAt!.replace(/^@/, "");

  const r = await f(
    `${registry}/api/v1/install/resolve?id=${encodeURIComponent(id)}`,
  );
  if (!r.ok) {
    throw new VerifyError(`resolve ${id} → ${r.status}`, "RESOLVE_FAILED");
  }
  const meta = (await r.json()) as ResolveResponse;

  const [bundleRes, sigRes, keysRes] = await Promise.all([
    fetchBytes(meta.bundleUrl),
    fetchBytes(meta.signatureUrl),
    f(`${registry}/api/v1/publishers/${publisher}/keys`),
  ]);
  if (!keysRes.ok) {
    throw new VerifyError(`keys ${keysRes.status}`, "KEYS_FAILED");
  }

  const sig = JSON.parse(
    Buffer.from(sigRes.bytes).toString("utf8"),
  ) as SignatureFile;
  const { keys } = (await keysRes.json()) as PublisherKeysResponse;

  // 1. zstd-decompress, verify header sha256 matches tar bytes.
  const tar = decompress(bundleRes.bytes);
  const tarSha = sha256Hex(tar);
  const headerSha = bundleRes.headers.get("x-oxp-bundle-sha256");
  if (headerSha && headerSha !== tarSha) {
    throw new VerifyError(
      `tar sha mismatch: ${tarSha} ≠ header ${headerSha}`,
      "DIGEST_MISMATCH",
    );
  }

  // 2. Signature payload digest matches tar.
  if (sig.payload.digest !== `sha256:${tarSha}`) {
    throw new VerifyError(
      `signature payload digest mismatch`,
      "SIG_DIGEST_MISMATCH",
    );
  }

  // 3. Look up publisher key by keyId, verify Ed25519.
  const pkRecord = keys.find((k) => k.keyId === sig.keyId);
  if (!pkRecord) {
    throw new VerifyError(`unknown keyId ${sig.keyId}`, "UNKNOWN_KEY");
  }
  if (pkRecord.revokedAt) {
    throw new VerifyError(`key revoked`, "KEY_REVOKED");
  }
  const pubKey = createPublicKey(pkRecord.publicKeyPem);
  const payloadCanon = Buffer.from(JSON.stringify(sig.payload));
  const sigBytes = Buffer.from(sig.signature, "base64");
  const ok = cryptoVerify(null, payloadCanon, pubKey, sigBytes);
  if (!ok) throw new VerifyError("Ed25519 verify failed", "SIG_VERIFY_FAILED");

  // 4. Unpack tar, parse manifest.
  const files = await readTar(tar);
  const manifestBytes = files.get("oxp.json");
  if (!manifestBytes) {
    throw new VerifyError("oxp.json missing from bundle", "NO_MANIFEST");
  }
  let manifest: ManifestCommon & Record<string, unknown>;
  try {
    manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  } catch (err) {
    throw new VerifyError(
      `oxp.json parse failed: ${(err as Error).message}`,
      "BAD_MANIFEST",
    );
  }

  // 4b. Phase A.11 — host-side WIT pin verification. Refuses components
  //     built against a contract this host does not actually implement.
  assertHostWitPin(manifest);

  return {
    id: meta.id,
    version: meta.version,
    publisher,
    slug: slug!,
    manifest,
    files,
    tarSha256: tarSha,
    keyId: sig.keyId,
  };
}
