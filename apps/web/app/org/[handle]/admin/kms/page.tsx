import { loadOrgContextOrRedirect, requireEnterprise } from "@/lib/org-auth";
import { prisma } from "@/lib/prisma";
import { KmsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function KmsAdmin({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const ctx = await loadOrgContextOrRedirect(handle);
  requireEnterprise(ctx);
  const row = await prisma.orgKmsKey.findUnique({
    where: { orgId: ctx.org.id },
  });
  const initial = row
    ? {
        provider: row.provider,
        keyRef: row.keyRef,
        region: row.region ?? "",
        algorithm: row.algorithm,
        publicKeyPem: row.publicKeyPem,
        hasCreds: Boolean(row.credentialsEnc),
        enabledAt: row.enabledAt?.toISOString() ?? null,
        lastError: row.lastError,
      }
    : null;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-mono text-sky-200">
      <h1 className="text-2xl tracking-[0.18em] uppercase mb-2">
        Customer-managed signing
      </h1>
      <p className="text-sm text-sky-300/60 mb-8">
        Sigstore signatures backed by your KMS key. We call{" "}
        <code className="text-sky-200">GetPublicKey</code> as a smoke test,
        cache the SPKI, and switch publish to your key. Today: AWS KMS (ECDSA
        P-256 and RSA-PSS SHA-256). GCP/Azure/Vault next.
      </p>
      <KmsForm orgHandle={handle} initial={initial} />
    </main>
  );
}
