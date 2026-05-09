import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { TokenManager, type TokenSummary } from "./TokenManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access Tokens" };

export default async function TokensPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/dashboard/tokens");

  const rows = await prisma.apiToken.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  const tokens: TokenSummary[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    scopes: t.scopes,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    expiresAt: t.expiresAt?.toISOString() ?? null,
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
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h1 className="auth-heading text-3xl font-black mb-2">
                API tokens
              </h1>
              <p className="auth-muted text-sm font-mono max-w-2xl">
                Tokens authenticate{" "}
                <code className="font-mono">oxp publish</code> and other CLI
                commands. Treat them like passwords — they grant publish rights
                to your namespace.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="app-container app-shell py-10">
        <TokenManager tokens={tokens} userHandle={me.handle} />
      </section>
    </div>
  );
}
