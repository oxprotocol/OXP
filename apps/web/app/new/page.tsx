import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { NewExtensionForm } from "./NewExtensionForm";

export const metadata = { title: "Reserve package id" };

export default async function NewExtensionPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/new");

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-12">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-[10px] font-mono text-[#f8fafc]/30 hover:text-[#7DD3FC] transition-colors tracking-wider uppercase mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            Dashboard
          </Link>
          <h1 className="text-3xl md:text-4xl font-black text-[#f8fafc] mb-2">
            New Extension
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40">
            Reserve a slug. Your bundle gets pushed via{" "}
            <code className="text-[#7DD3FC]/70">oxp publish</code>.
          </p>
        </div>
      </section>

      <section className="app-container app-shell py-12 max-w-[1100px]">
        <NewExtensionForm ownerHandle={me.handle} />
      </section>
    </div>
  );
}
