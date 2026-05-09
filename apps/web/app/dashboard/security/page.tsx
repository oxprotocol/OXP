import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getPublisherTrust } from "@/lib/publisher-level";
import {
  challengeHost,
  challengeRecord,
  listVerifications,
} from "@/lib/publisher-verification";
import { TwoFactorPanel } from "./TwoFactorPanel";
import { PublisherVerificationPanel } from "./PublisherVerificationPanel";
import type {
  PendingVerification,
  VerifiedVerification,
} from "./DomainVerificationWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/dashboard/security");

  const sp = await searchParams;
  const verifyStatus =
    typeof sp.verify === "string"
      ? sp.verify
      : Array.isArray(sp.verify)
        ? sp.verify[0]
        : undefined;
  const verifyActual =
    typeof sp.actual === "string"
      ? sp.actual
      : Array.isArray(sp.actual)
        ? sp.actual[0]
        : undefined;
  const defaultDomain =
    typeof sp.domain === "string"
      ? sp.domain
      : Array.isArray(sp.domain)
        ? sp.domain[0]
        : undefined;

  const [user, trust, verifications] = await Promise.all([
    prisma.user.findUnique({
      where: { id: me.id },
      select: { totpEnrolledAt: true, recoveryCodesHash: true },
    }),
    getPublisherTrust(me.handle),
    listVerifications(me.handle),
  ]);

  const dnsRows = verifications.filter((v) => v.method === "dns_txt");
  const verifiedDomains: VerifiedVerification[] = dnsRows
    .filter((v) => v.status === "verified" && v.verifiedAt)
    .map((v) => ({
      id: v.id,
      target: v.target,
      verifiedAt: v.verifiedAt!.toISOString(),
    }));
  const pendingDomains: PendingVerification[] = dnsRows
    .filter((v) => v.status === "pending" && v.expiresAt > new Date())
    .map((v) => ({
      id: v.id,
      target: v.target,
      host: challengeHost(v.target),
      expectedRecord: challengeRecord(v.token),
      expiresAt: v.expiresAt.toISOString(),
      status: v.status,
      reason: v.reason ?? null,
    }));

  return (
    <div
      className="dash-shell flex flex-col flex-1 w-full"
      style={{ zIndex: 2 }}
    >
      <section className="border-b border-(--auth-card-br) bg-(--auth-card-bg) backdrop-blur-sm">
        <div className="app-container app-shell py-10">
          <Link
            href="/dashboard"
            className="auth-dim hover:auth-accent inline-flex items-center gap-2 text-xs font-mono mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to dashboard
          </Link>
          <div className="flex items-start gap-4">
            <div className="auth-icon-tile p-3 rounded inline-flex">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="auth-heading text-3xl font-black mb-2">
                Security
              </h1>
              <p className="auth-muted text-sm font-mono max-w-2xl">
                Two-factor authentication (TOTP) protects publish operations.
                When enabled, every{" "}
                <code className="font-mono">oxp publish</code> requires a fresh
                authenticator code.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="app-container app-shell py-10">
        <TwoFactorPanel
          enrolled={!!user?.totpEnrolledAt}
          enrolledAt={user?.totpEnrolledAt?.toISOString() ?? null}
          remainingRecoveryCodes={user?.recoveryCodesHash.length ?? 0}
        />
        <PublisherVerificationPanel
          handle={me.handle}
          trust={trust}
          status={verifyStatus}
          statusActual={verifyActual}
          pendingDomains={pendingDomains}
          verifiedDomains={verifiedDomains}
          defaultDomain={defaultDomain}
        />
      </section>
    </div>
  );
}
