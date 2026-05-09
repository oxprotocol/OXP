import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div
      className="flex flex-col flex-1 w-full items-center justify-center py-20 px-4 text-center"
      style={{ zIndex: 2 }}
    >
      <div className="p-3 rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 inline-flex mb-6">
        <AlertTriangle className="w-6 h-6 text-[#7DD3FC]" />
      </div>
      <p className="text-[10px] font-mono font-bold tracking-[0.3em] text-[#7DD3FC]/60 uppercase mb-3">
        {"// Error 404"}
      </p>
      <h1 className="text-4xl md:text-6xl font-black text-[#f8fafc] mb-4">
        Lost in orbit
      </h1>
      <p className="text-sm font-mono text-[#f8fafc]/40 max-w-md mb-8">
        That route isn&apos;t registered with the protocol. Check the URL or
        head back to base.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 px-6 py-3 bg-[#7DD3FC] text-[#060a13] font-mono font-bold text-sm tracking-wider uppercase rounded hover:bg-[#BAE6FD] transition-all"
      >
        <ArrowLeft className="w-4 h-4" />
        Return home
      </Link>
    </div>
  );
}
