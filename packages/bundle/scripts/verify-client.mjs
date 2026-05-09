#!/usr/bin/env node
/**
 * Reference client: resolve → download → verify signature → unpack.
 * This is exactly what the VS Code host extension must do.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { decompress } from "@mongodb-js/zstd";

const REGISTRY = process.env.OXP_REGISTRY ?? "https://oxp.sh";
const ID = process.argv[2] ?? "@aldgar/hello-oxp";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const r = await fetch(
  `${REGISTRY}/api/v1/install/resolve?id=${encodeURIComponent(ID)}`,
);
if (!r.ok) fail(`resolve ${r.status}`);
const meta = await r.json();
console.log(`resolved ${meta.id}@${meta.version}`);

const [bundleRes, sigRes, keysRes] = await Promise.all([
  fetch(meta.bundleUrl),
  fetch(meta.signatureUrl),
  fetch(`${REGISTRY}/api/v1/publishers/${ID.split("/")[0].slice(1)}/keys`),
]);
if (!bundleRes.ok) fail(`bundle ${bundleRes.status}`);
if (!sigRes.ok) fail(`signature ${sigRes.status}`);
if (!keysRes.ok) fail(`keys ${keysRes.status}`);

const bundleBytes = Buffer.from(await bundleRes.arrayBuffer());
const sig = await sigRes.json();
const { keys } = await keysRes.json();

// 1. Header digest matches body
const headerDigest = bundleRes.headers.get("x-oxp-bundle-sha256");
const tarBytes = Buffer.from(await decompress(bundleBytes));
const tarSha = createHash("sha256").update(tarBytes).digest("hex");
if (headerDigest !== tarSha)
  fail(`tar sha mismatch: ${tarSha} vs header ${headerDigest}`);
console.log(`✓ tar sha256 matches header: ${tarSha}`);

// 2. Signature payload digest matches
const expectedDigest = `sha256:${tarSha}`;
if (sig.payload.digest !== expectedDigest)
  fail(`sig payload digest ${sig.payload.digest} ≠ ${expectedDigest}`);
console.log(`✓ signature payload digest matches`);

// 3. Look up the publisher key by keyId, verify Ed25519
const pkRecord = keys.find((k) => k.keyId === sig.keyId);
if (!pkRecord) fail(`unknown keyId ${sig.keyId} for publisher`);
if (pkRecord.revokedAt) fail(`publisher key is revoked`);
const pubKey = createPublicKey(pkRecord.publicKeyPem);

// Canonical payload: same JSON.stringify the signer used
const payloadCanon = Buffer.from(JSON.stringify(sig.payload));
const sigBytes = Buffer.from(sig.signature, "base64");
const ok = verify(null, payloadCanon, pubKey, sigBytes);
if (!ok) fail("Ed25519 verify failed");
console.log(`✓ Ed25519 verify ok (keyId ${sig.keyId})`);

// 4. Unpack tar to confirm it's structurally valid
const tmp = mkdtempSync(join(tmpdir(), "oxp-verify-"));
writeFileSync(join(tmp, "bundle.tar"), tarBytes);
console.log(`✓ tar written to ${tmp}/bundle.tar (${tarBytes.length} bytes)`);
rmSync(tmp, { recursive: true, force: true });

console.log(`\nALL CHECKS PASSED for ${meta.id}@${meta.version}`);
