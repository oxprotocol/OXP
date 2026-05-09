import Link from "next/link";
import { BadgeCheck, ArrowRight, X } from "lucide-react";
import type { PublisherTrust } from "@/lib/publisher-level";

/**
 * Phase B.8 — dashboard nudge prompting unverified publishers to upgrade
 * to Level 2 (GitHub) or Level 3 (Domain). Renders nothing once the user
 * has at least Level 2.
 *
 * Server component — no interactive dismiss; users just earn the badge
 * to make it disappear.
 */
export function VerifyNudge({ trust }: { trust: PublisherTrust | null }) {
  if (!trust || trust.level !== "unverified") return null;

  return (
    <div className="hud-card hud-corners p-5 mb-6 flex items-start gap-4 border-[#7DD3FC]/20 bg-[#7DD3FC]/5">
      <div className="p-2 rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/10 text-[#7DD3FC] shrink-0">
        <BadgeCheck className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-mono font-bold text-[#7DD3FC] mb-1">
          Get a verified badge on every listing.
        </h3>
        <p className="text-xs font-mono text-[#f8fafc]/50 leading-relaxed mb-3 max-w-2xl">
          Sign in with GitHub to upgrade your handle to{" "}
          <span className="text-sky-400">Level 2 · GitHub</span>. Takes about
          twenty seconds. We never post on your behalf — only your public{" "}
          <code>login</code> is read.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Plain <a> — this route 307-redirects to github.com, which Next's
              RSC prefetcher can't follow cross-origin. */}
          <a
            href="/api/verify/github/start"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
          >
            Verify with GitHub <ArrowRight className="w-3.5 h-3.5" />
          </a>
          <Link
            href="/dashboard/security"
            prefetch={false}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono text-[#7DD3FC]/70 hover:text-[#7DD3FC]"
          >
            Domain (Level 3) →
          </Link>
        </div>
      </div>
    </div>
  );
}
