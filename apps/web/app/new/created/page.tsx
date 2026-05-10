import Link from "next/link";
import { ArrowRight, CheckCircle2, Copy, Terminal } from "lucide-react";

export const metadata = { title: "Package created" };

export default async function CreatedPage({
  searchParams,
}: {
  searchParams: Promise<{ handle?: string; slug?: string }>;
}) {
  const { handle = "you", slug = "your-extension" } = await searchParams;
  const installId = `@${handle}/${slug}`;
  const cmd = `npx @oxprotocol/cli create ${slug}`;

  return (
    <section className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20 w-full">
      <div className="hud-card hud-corners p-10 space-y-6 text-center">
        <div className="inline-flex p-3 rounded-full border border-emerald-500/30 bg-emerald-500/5 text-emerald-400">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-[#f8fafc] mb-2">
            Slug reserved.
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40">
            <span className="text-[#7DD3FC]">{installId}</span> is yours. Push
            your first version to publish it.
          </p>
        </div>

        <div className="text-left space-y-2">
          <div className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
            {"// Push from your machine"}
          </div>
          <div className="bg-[#030711] rounded border border-[#7DD3FC]/15 p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              <Terminal className="w-4 h-4 text-[#7DD3FC]/40 flex-shrink-0" />
              <code className="text-xs font-mono text-[#f8fafc]/70 whitespace-nowrap">
                <span className="text-[#7DD3FC]/40">$</span> {cmd}
              </code>
            </div>
            <button className="text-[#f8fafc]/20 hover:text-[#7DD3FC] transition-colors flex-shrink-0">
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] font-mono text-[#f8fafc]/30">
            The CLI scaffolds <code className="text-[#7DD3FC]/60">body/</code>,{" "}
            <code className="text-[#7DD3FC]/60">brain/</code>, and{" "}
            <code className="text-[#7DD3FC]/60">oxp.json</code>. Run{" "}
            <code className="text-[#7DD3FC]/60">oxp publish</code> when ready.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 pt-4">
          <Link
            href={`/${handle}/${slug}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-[10px] font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10"
          >
            View Repo <ArrowRight className="w-3 h-3" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-[10px] font-mono font-bold tracking-wider uppercase text-[#f8fafc]/40 hover:text-[#7DD3FC]"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
