import React from "react";
import { Download, Star, Box, ChevronRight } from "lucide-react";
import { StatusBadges } from "./Badge";
import { VerifiedBadge } from "./VerifiedBadge";

export interface ExtensionCardProps {
  name: string;
  author: string;
  description: string;
  version: string;
  downloads: string;
  stars: number;
  /** When `planned`, the card honestly signals the entry is announced but
   *  not yet installable. Defaults to `available`. */
  availability?: "available" | "planned";
  /** Drives the badge row (`vsx-compatible`, `oxp-native-planned`, etc). */
  tags?: string[];
  /** Phase B.8 — publisher trust tier (denormalized on User/Organization). */
  verificationLevel?: "unverified" | "github" | "domain";
  verifiedDomain?: string | null;
  verifiedGithub?: string | null;
}

export function ExtensionCard({
  name,
  author,
  description,
  version,
  downloads,
  stars,
  availability = "available",
  tags = [],
  verificationLevel,
  verifiedDomain,
  verifiedGithub,
}: ExtensionCardProps) {
  const isPlanned = availability === "planned";

  return (
    <div className="hud-card hud-corners p-6 flex flex-col h-full group cursor-pointer">
      {/* Scan line on hover */}
      <div className="absolute inset-0 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#7DD3FC]/30 to-transparent animate-pulse-glow" />
      </div>

      {/* Header */}
      <div className="flex justify-between items-start mb-3 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 border border-[#7DD3FC]/20 rounded bg-[#7DD3FC]/5 text-[#7DD3FC] group-hover:border-[#7DD3FC]/40 group-hover:shadow-[0_0_12px_rgba(125,211,252,0.1)] transition-all flex-shrink-0">
            <Box className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-mono font-bold text-[#7DD3FC] mb-0.5 group-hover:text-[#BAE6FD] transition-colors flex items-center gap-1 truncate">
              <span className="truncate">{name}</span>
              <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0 flex-shrink-0" />
            </h3>
            <p className="text-xs font-mono text-[#f8fafc]/30 tracking-wider uppercase truncate flex items-center gap-1.5">
              <span className="truncate">{author}</span>
              <VerifiedBadge
                level={verificationLevel}
                domain={verifiedDomain}
                githubLogin={verifiedGithub}
                size="sm"
              />
            </p>
          </div>
        </div>
      </div>

      {/* Status badges (VSX Compatible / OXP Native Planned / etc) */}
      <StatusBadges tags={tags} className="mb-3" />

      {/* Description */}
      <p className="text-[#f8fafc]/50 flex-1 text-xs mb-6 line-clamp-3 leading-relaxed font-mono">
        {description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-4 border-t border-[#7DD3FC]/10">
        <span className="text-xs font-mono font-bold px-2 py-1 rounded border border-[#7DD3FC]/15 text-[#7DD3FC]/60 bg-[#7DD3FC]/5">
          {isPlanned ? `Target v${version}` : `v${version}`}
        </span>
        <div className="flex items-center gap-4 text-xs font-mono text-[#f8fafc]/30">
          <div className="flex items-center gap-1">
            <Download className="w-3.5 h-3.5" />
            <span>{isPlanned ? "—" : downloads}</span>
          </div>
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-[#7DD3FC]/40 fill-[#7DD3FC]/30" />
            <span>{isPlanned ? "—" : stars}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
