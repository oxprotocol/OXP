/**
 * Custom domain admin. Server Component shell + interactive client form.
 * The form hits /api/org/[handle]/domain (PUT/DELETE) and
 * /api/org/[handle]/domain/verify (POST).
 */
import { loadOrgContextOrRedirect, requireTeamsPlus } from "@/lib/org-auth";
import { prisma } from "@/lib/prisma";
import { verifyRecordName } from "@/lib/dns-verify";
import { DomainForm } from "./form";

export const dynamic = "force-dynamic";

export default async function DomainAdmin({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const ctx = await loadOrgContextOrRedirect(handle);
  requireTeamsPlus(ctx);

  const row = await prisma.orgDomain.findFirst({
    where: { orgId: ctx.org.id },
  });
  const initial = row
    ? {
        hostname: row.hostname,
        status: row.status,
        verifyToken: row.verifyToken,
        recordName: verifyRecordName(row.hostname),
        lastError: row.lastError,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
      }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-mono text-sky-200">
      <h1 className="text-2xl tracking-[0.18em] uppercase mb-2">
        Custom domain
      </h1>
      <p className="text-sm text-sky-300/60 mb-8">
        Serve the registry on a hostname you control. Add the verification TXT
        record at the printed name and click Verify. Once verified, point the
        hostname's CNAME to <code className="text-sky-200">edge.oxp.sh</code>.
      </p>
      <DomainForm orgHandle={handle} initial={initial} />
    </main>
  );
}
