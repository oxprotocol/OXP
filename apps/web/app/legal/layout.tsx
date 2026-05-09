import Link from "next/link";
import { Scale, Shield, RotateCcw, ArrowLeft } from "lucide-react";

const sections = [
  { href: "/legal/terms", label: "Terms of Service", icon: Scale },
  { href: "/legal/privacy", label: "Privacy Policy", icon: Shield },
  { href: "/legal/refund", label: "Refund Policy", icon: RotateCcw },
] as const;

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {/* ─── HERO STRIP ─── */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-mono text-[#f8fafc]/40 hover:text-[#7DD3FC] transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to oxp.sh
          </Link>
          <div className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase mb-3">
            {"// Legal"}
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[#f8fafc]">
            Plain-language legal,
            <br />
            <span className="text-[#7DD3FC]">EU-compliant by default.</span>
          </h1>
        </div>
      </section>

      {/* ─── PAGE NAV ─── */}
      <nav className="border-b border-[#7DD3FC]/10 bg-[#030711]/60 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <ul className="flex flex-wrap gap-1 -mb-px">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="inline-flex items-center gap-2 px-4 py-3 text-xs font-mono font-bold tracking-wider uppercase text-[#f8fafc]/50 hover:text-[#7DD3FC] border-b-2 border-transparent hover:border-[#7DD3FC]/40 aria-[current=page]:text-[#7DD3FC] aria-[current=page]:border-[#7DD3FC] transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* ─── CONTENT ─── */}
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full legal-prose">
        {children}
      </article>
    </div>
  );
}
