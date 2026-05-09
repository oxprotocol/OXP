/**
 * Helpers around the registry's publish flow.
 *
 * - resolves a publisher handle to a User or Organization the caller may publish under
 * - establishes / verifies the publisher's Ed25519 signing key
 * - performs the write that turns a validated upload into a Version row + blob
 */

import { prisma } from "@/lib/prisma";
import { putBundle, hasBundle } from "@/lib/blob-store";
import { recordAudit } from "@/lib/audit";
import {
  digestBundle,
  unpackBundle,
  verifyEd25519,
  decompressBundle,
  assertBundlePolicy,
  assertWitPin,
  extractHostImports,
  findMissingPermissions,
  BundlePolicyError,
  WitPinError,
  BUNDLE_LIMITS,
  type Ed25519Signature,
  verifySigstore,
  type SigstoreBundle,
  type SigstoreVerification,
} from "@oxprotocol/bundle";
import { assertManifest } from "@oxprotocol/schema";
import type { OxpManifest } from "@oxprotocol/types";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { User } from "@prisma/client";

export interface PublishInput {
  user: User;
  oxp: Buffer; // the .oxp bytes (zstd-compressed tar)
  signature: Ed25519Signature;
  /** Public key registered (or to-be-registered) for the publisher. PEM. */
  publicKeyPem: string;
  /**
   * Optional Phase B.5 attestation envelope (DSSE / in-toto JSON). The
   * registry persists it verbatim; cryptographic verification against
   * sigstore / Fulcio is deferred to Phase B.5b.
   */
  attestation?: unknown;
  /**
   * Phase B.5b — Sigstore keyless signature bundle. When provided, the
   * registry verifies it cryptographically against Fulcio's published
   * trust root and the Rekor transparency log; fields like `signerIdentity`
   * and `rekorLogIndex` are stored on the Version row so anyone can
   * audit the signing event independently.
   */
  sigstoreBundle?: SigstoreBundle;
}

export type PublishResult =
  | {
      ok: true;
      extensionId: string;
      versionId: string;
      semver: string;
      manifest: OxpManifest;
    }
  | { ok: false; status: 400 | 403 | 409 | 422; error: string };

export async function publishVersion(
  input: PublishInput,
): Promise<PublishResult> {
  const { user, oxp, signature, publicKeyPem } = input;

  // 0. Pillar 8.3 — compressed bundle size cap. Cheapest possible
  //    rejection; runs before we touch the disk.
  if (oxp.byteLength > BUNDLE_LIMITS.compressedBytes) {
    return {
      ok: false,
      status: 422,
      error: `bundle exceeds compressed size cap (${oxp.byteLength} bytes > ${BUNDLE_LIMITS.compressedBytes}). See Pillar 8.3.`,
    };
  }

  // 1. Unpack to a temp dir to get the manifest. (Cheap; bundles are <64 MiB.)
  const tmp = await mkdtemp(join(tmpdir(), "oxp-publish-"));
  let manifest: OxpManifest;
  let bundleSha256: string;
  let bundleFilePaths: string[] = [];
  let wasmBytes: Buffer | undefined;
  try {
    const unpacked = await unpackBundle(oxp, tmp);
    manifest = unpacked.manifest;
    bundleFilePaths = unpacked.files ?? [];
    // Pull the .wasm bytes (if any) into memory before we drop the
    // tmp dir — needed by the Phase A.4 imports/permissions check.
    const wasmRel = manifest.main?.wasm;
    if (wasmRel) {
      try {
        wasmBytes = await readFile(join(tmp, wasmRel));
      } catch {
        // If the manifest names a wasm that isn't in the bundle the
        // schema/bundle-policy checks above will reject it; leave
        // wasmBytes undefined and continue.
      }
    }
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    return {
      ok: false,
      status: 422,
      error: `bundle unpack failed: ${(e as Error).message}`,
    };
  }
  await rm(tmp, { recursive: true, force: true });

  // 1b. Phase A.10 / A.3 — enforce bundle policy server-side. The CLI
  //     also runs this, but the registry MUST NOT trust the client.
  //     `publisherVerified` is hardcoded false until Phase B.1 ships
  //     domain verification; verified-only capabilities (terminal.*,
  //     process.kill) are rejected here for now.
  try {
    assertBundlePolicy(manifest, bundleFilePaths, { publisherVerified: false });
  } catch (e) {
    if (e instanceof BundlePolicyError) {
      return { ok: false, status: 422, error: `policy: ${e.message}` };
    }
    return { ok: false, status: 422, error: (e as Error).message };
  }

  // 1c. Phase A.11 — WIT contract pin verification. ui-v1 bundles get a
  //     no-op (pin optional); component-v1 / hybrid-v1 must declare a pin
  //     whose sha256 matches this server's @oxprotocol/wit world.
  try {
    assertWitPin(manifest);
  } catch (e) {
    if (e instanceof WitPinError) {
      return { ok: false, status: 422, error: `wit-pin: ${e.message}` };
    }
    return { ok: false, status: 422, error: (e as Error).message };
  }

  // 1d. Phase A.4 — manifest.permissions ⊇ component imports. The host
  //     re-runs the same check at install time as defence-in-depth, but
  //     catching this server-side means a malicious publisher cannot
  //     publish a binary that imports `oxp:host/fs` while declaring no
  //     `fs.*` permissions (which would otherwise bypass the install
  //     prompt — the prompt UI is built from manifest.permissions).
  if (wasmBytes) {
    const imports = extractHostImports(wasmBytes);
    const gaps = findMissingPermissions(
      imports,
      (manifest.permissions ?? []) as unknown as readonly string[],
    );
    if (gaps.length > 0) {
      const gapDesc = gaps
        .map(
          (g) =>
            `oxp:host/${g.interface} requires one of [${g.oneOf.join(", ")}]`,
        )
        .join("; ");
      return {
        ok: false,
        status: 422,
        error:
          `permissions: component imports interfaces that ` +
          `manifest.permissions does not cover: ${gapDesc}`,
      };
    }
  }

  // 2. Recompute the bundle digest from the on-the-wire bytes by re-hashing
  //    the uncompressed tar. We reuse the unpack code path's decompression
  //    by computing on the already-decompressed stream — call digestBundle
  //    on the raw tar form. To get that, decompress here.
  try {
    const tarBytes = await decompressBundle(oxp);
    bundleSha256 = digestBundle(tarBytes);
  } catch (e) {
    return {
      ok: false,
      status: 422,
      error: `bundle decompress failed: ${(e as Error).message}`,
    };
  }

  // 3. Check signature payload digest matches
  if (signature.payload.digest !== `sha256:${bundleSha256}`) {
    return {
      ok: false,
      status: 422,
      error: `signature digest mismatch: expected sha256:${bundleSha256}, signed sha256:${signature.payload.digest.replace(/^sha256:/, "")}`,
    };
  }

  // 4. Validate manifest (defensive — already done in unpack, but explicit)
  try {
    assertManifest(manifest);
  } catch (e) {
    return { ok: false, status: 422, error: (e as Error).message };
  }

  // 5. Verify publisher handle in manifest matches the id segment
  const idMatch = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(manifest.id);
  if (!idMatch || idMatch[1] !== manifest.publisher) {
    return {
      ok: false,
      status: 422,
      error: "manifest.id publisher segment must equal manifest.publisher",
    };
  }
  const publisherHandle = manifest.publisher;
  const slug = idMatch[2]!;

  // 6. Authorize: caller's handle must equal publisher handle, OR the
  //    publisher is an org and caller is a member with role >= contributor.
  const allowed = await callerCanPublishAs(user, publisherHandle);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: `not authorized to publish under @${publisherHandle}`,
    };
  }

  // 7. Verify the Ed25519 signature against the supplied public key
  if (!verifyEd25519(signature, publicKeyPem)) {
    return {
      ok: false,
      status: 422,
      error: "Ed25519 signature verification failed",
    };
  }
  if (signature.keyId !== keyIdFromPem(publicKeyPem)) {
    return {
      ok: false,
      status: 422,
      error: "signature keyId does not match supplied public key",
    };
  }

  // 7b. Phase B.5b — verify the optional Sigstore bundle. Sigstore covers
  //     the same canonical payload as the Ed25519 layer (`signature.payload`
  //     JSON). On success we extract the OIDC identity and Rekor coordinates
  //     so they can be persisted as searchable columns and re-verified by
  //     anyone offline against Fulcio's trust root.
  let sigstoreVerified: SigstoreVerification | null = null;
  if (input.sigstoreBundle) {
    const payloadBytes = Buffer.from(JSON.stringify(signature.payload), "utf8");
    try {
      sigstoreVerified = await verifySigstore(
        payloadBytes,
        input.sigstoreBundle,
      );
    } catch (e) {
      return {
        ok: false,
        status: 422,
        error: `sigstore verification failed: ${(e as Error).message}`,
      };
    }
  }

  // 8. Establish or verify the publisher's signing key
  const existingKey = await prisma.publisherKey.findFirst({
    where: { publisherHandle, revokedAt: null },
    orderBy: { registeredAt: "asc" },
  });
  if (existingKey) {
    if (existingKey.keyId !== signature.keyId) {
      return {
        ok: false,
        status: 403,
        error: `publisher @${publisherHandle} is bound to key ${existingKey.keyId}; got ${signature.keyId}`,
      };
    }
  } else {
    await prisma.publisherKey.create({
      data: {
        publisherHandle,
        algorithm: "ed25519",
        publicKeyPem,
        keyId: signature.keyId,
        registeredByUserId: user.id,
      },
    });
  }

  // 9. Find or create the Extension row (caller already authorized as publisher)
  const owner = await resolvePublisherOwner(publisherHandle);
  if (!owner) {
    return {
      ok: false,
      status: 422,
      error: `publisher handle @${publisherHandle} is not a registered namespace`,
    };
  }
  const extension = await prisma.extension.upsert({
    where: { ownerHandle_slug: { ownerHandle: publisherHandle, slug } },
    create: {
      ownerHandle: publisherHandle,
      ownerKind: owner.kind,
      ownerId: owner.id,
      slug,
      title: manifest.displayName,
      description: manifest.description ?? "",
      tags: manifest.keywords ?? [],
      repositoryUrl: manifest.repository ?? null,
    },
    update: {
      title: manifest.displayName,
      description: manifest.description ?? "",
      tags: manifest.keywords ?? [],
      repositoryUrl: manifest.repository ?? null,
    },
  });

  // 10. Reject duplicate semver
  const dup = await prisma.version.findUnique({
    where: {
      extensionId_semver: {
        extensionId: extension.id,
        semver: manifest.version,
      },
    },
  });
  if (dup) {
    return {
      ok: false,
      status: 409,
      error: `version ${manifest.version} of @${publisherHandle}/${slug} already exists`,
    };
  }

  // 11. Store the blob (idempotent on sha256)
  if (!(await hasBundle(bundleSha256))) {
    await putBundle(bundleSha256, oxp);
  }

  // 12. Insert Version row
  const version = await prisma.version.create({
    data: {
      extensionId: extension.id,
      semver: manifest.version,
      bundleSha256,
      bundleSize: BigInt(oxp.byteLength),
      signedByUserId: user.id,
      signatureKeyId: signature.keyId,
      signatureAlgo: sigstoreVerified ? "ed25519+sigstore" : "ed25519",
      signatureJson: signature as unknown as object,
      sigstoreBundle: input.sigstoreBundle
        ? (input.sigstoreBundle as unknown as object)
        : undefined,
      rekorLogIndex: sigstoreVerified?.logIndex ?? undefined,
      signerIdentity: sigstoreVerified?.identity ?? undefined,
      signerIssuer: sigstoreVerified?.issuer ?? undefined,
      manifestJson: manifest as unknown as object,
      provenanceJson:
        manifest.provenance && Object.keys(manifest.provenance).length > 0
          ? (manifest.provenance as unknown as object)
          : undefined,
      attestationJson:
        input.attestation !== undefined
          ? (input.attestation as object)
          : undefined,
    },
  });

  // 13. Bump latestVersion if this is the highest semver we've seen
  await prisma.extension.update({
    where: { id: extension.id },
    data: {
      latestVersion: pickHigherSemver(
        extension.latestVersion,
        manifest.version,
      ),
    },
  });

  // Audit — record publish + sigstore outcome.
  const ownerKind: "user" | "org" =
    extension.ownerKind === "org" ? "org" : "user";
  await recordAudit({
    action: "extension.publish",
    target: `@${publisherHandle}/${slug}@${manifest.version}`,
    actorUserId: user.id,
    orgId: ownerKind === "org" ? extension.ownerId : null,
    metadata: {
      versionId: version.id,
      bundleSha256,
      sigstore: !!sigstoreVerified,
    },
  });
  if (sigstoreVerified) {
    await recordAudit({
      action: "sigstore.verify",
      target: `@${publisherHandle}/${slug}@${manifest.version}`,
      actorUserId: user.id,
      orgId: ownerKind === "org" ? extension.ownerId : null,
      metadata: {
        identity: sigstoreVerified.identity,
        issuer: sigstoreVerified.issuer,
        logIndex: sigstoreVerified.logIndex,
      },
    });
  }

  return {
    ok: true,
    extensionId: extension.id,
    versionId: version.id,
    semver: manifest.version,
    manifest,
  };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

async function callerCanPublishAs(
  user: User,
  publisherHandle: string,
): Promise<boolean> {
  if (user.handle === publisherHandle) return true;
  // Alias namespace (NamespaceHandle row owned by the user, kind=user).
  const ns = await prisma.namespaceHandle.findUnique({
    where: { handle: publisherHandle },
  });
  if (ns && ns.kind === "user" && ns.ownerId === user.id) return true;
  const org = await prisma.organization.findUnique({
    where: { handle: publisherHandle },
  });
  if (!org) return false;
  const membership = await prisma.membership.findFirst({
    where: {
      orgId: org.id,
      userId: user.id,
      role: { in: ["owner", "admin", "contributor"] },
    },
  });
  return Boolean(membership);
}

async function resolvePublisherOwner(
  handle: string,
): Promise<{ id: string; kind: "user" | "org" } | null> {
  const u = await prisma.user.findUnique({
    where: { handle },
    select: { id: true },
  });
  if (u) return { id: u.id, kind: "user" };
  const o = await prisma.organization.findUnique({
    where: { handle },
    select: { id: true },
  });
  if (o) return { id: o.id, kind: "org" };
  // Alias namespace fallback.
  const ns = await prisma.namespaceHandle.findUnique({ where: { handle } });
  if (ns && ns.kind === "user") return { id: ns.ownerId, kind: "user" };
  if (ns && ns.kind === "org") return { id: ns.ownerId, kind: "org" };
  return null;
}

function pickHigherSemver(a: string | null, b: string): string {
  if (!a) return b;
  return semverCompare(a, b) >= 0 ? a : b;
}

/** Naive semver compare — sufficient for "is X >= Y" between published versions. */
function semverCompare(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.parts[i]! !== pb.parts[i]!) return pa.parts[i]! - pb.parts[i]!;
  }
  // Pre-release: a release is higher than any pre-release of the same triple.
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre && pb.pre) return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
  return 0;
}

function parseSemver(v: string): {
  parts: [number, number, number];
  pre: string;
} {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v);
  if (!m) return { parts: [0, 0, 0], pre: "" };
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" };
}

function keyIdFromPem(pem: string): string {
  // Re-implements @oxprotocol/bundle's keyIdOf without re-importing to avoid a cycle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createPublicKey, createHash } =
    require("node:crypto") as typeof import("node:crypto");
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return `ed25519:0x${createHash("sha256").update(der).digest("hex")}`;
}
