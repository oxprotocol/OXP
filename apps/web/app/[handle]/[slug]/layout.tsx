import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { getExtension, extensions } from "@/lib/registry";
import { getExtensionDb } from "@/lib/registry-db";
import { getCurrentUser } from "@/lib/auth";
import { RepoTabs } from "@/components/repo/RepoTabs";

export function generateStaticParams() {
  // Pre-render the seed extensions only; DB-published rows render on demand.
  return extensions.map((e) => ({ handle: e.ownerHandle, slug: e.slug }));
}

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  // Seed first (fast, in-memory), then DB so newly published extensions resolve.
  const ext =
    getExtension(handle, slug) ??
    (await getExtensionDb(handle, slug).catch(() => null));
  if (!ext) notFound();

  const me = await getCurrentUser();
  const isOwner = !!me && me.handle === ext.ownerHandle;
  const isPrivate = ext.visibility === "private";

  return (
    <div className="flex flex-col flex-1 w-full relative" style={{ zIndex: 2 }}>
      {/* Breadcrumb + title strip */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell pt-8 pb-0">
          <div className="flex items-center gap-2 mb-6">
            <Link
              href="/packages"
              className="flex items-center gap-2 text-xs font-mono text-[#f8fafc]/40 hover:text-[#7DD3FC] transition-colors tracking-wider uppercase"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Registry
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-[#f8fafc]/20" />
            <Link
              href={`/${ext.ownerHandle}`}
              className="text-xs font-mono text-[#7DD3FC]/70 hover:text-[#7DD3FC] tracking-wider uppercase"
            >
              {ext.ownerHandle}
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-[#f8fafc]/20" />
            <span className="text-xs font-mono text-[#f8fafc]/60 tracking-wider">
              {ext.slug}
            </span>
          </div>

          <div className="flex items-center gap-4 flex-wrap mb-8">
            <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc]">
              <Link
                href={`/${ext.ownerHandle}`}
                className="text-[#7DD3FC]/70 hover:text-[#7DD3FC]"
              >
                @{ext.ownerHandle}
              </Link>
              <span className="text-[#f8fafc]/20 mx-2">/</span>
              <span>{ext.slug}</span>
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded uppercase tracking-wider ${
                isPrivate
                  ? "border border-[#f8fafc]/20 text-[#f8fafc]/50 bg-[#f8fafc]/5"
                  : "border border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
              }`}
            >
              {isPrivate ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" /> Private
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" /> Public
                </>
              )}
            </span>
          </div>

          <RepoTabs
            ownerHandle={ext.ownerHandle}
            slug={ext.slug}
            isOwner={isOwner}
          />
        </div>
      </section>

      {children}
    </div>
  );
}
