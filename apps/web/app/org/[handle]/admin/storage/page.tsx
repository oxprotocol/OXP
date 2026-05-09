import { loadOrgContextOrRedirect, requireEnterprise } from "@/lib/org-auth";
import { prisma } from "@/lib/prisma";
import { StorageForm } from "./form";

export const dynamic = "force-dynamic";

export default async function StorageAdmin({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const ctx = await loadOrgContextOrRedirect(handle);
  requireEnterprise(ctx);
  const row = await prisma.orgStorageBackend.findUnique({
    where: { orgId: ctx.org.id },
  });
  const initial = row
    ? {
        provider: row.provider,
        bucket: row.bucket,
        region: row.region ?? "",
        endpoint: row.endpoint ?? "",
        accessKeyId: row.accessKeyId,
        sseKmsKeyId: row.sseKmsKeyId ?? "",
        prefix: row.prefix,
        hasSecret: Boolean(row.secretEnc),
        enabledAt: row.enabledAt?.toISOString() ?? null,
        lastError: row.lastError,
      }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-mono text-sky-200">
      <h1 className="text-2xl tracking-[0.18em] uppercase mb-2">
        Bring your own storage
      </h1>
      <p className="text-sm text-sky-300/60 mb-8">
        Extension blobs (`*.oxp`) get pushed to your bucket. We run a probe
        PUT/GET/DELETE before flipping enabled. AWS S3, Cloudflare R2, and MinIO
        are supported via S3 API. Azure Blob & GCS coming next.
      </p>
      <StorageForm orgHandle={handle} initial={initial} />
    </main>
  );
}
