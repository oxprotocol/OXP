import { GitCommit } from "lucide-react";
import type { RepoTree } from "@/lib/repos";

export function CommitStrip({ tree }: { tree: RepoTree }) {
  const c = tree.lastCommit;
  return (
    <div className="hud-card hud-corners px-5 py-3 flex items-center justify-between gap-4 mb-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-1.5 rounded border border-[#7DD3FC]/15 bg-[#7DD3FC]/5 text-[#7DD3FC]/70">
          <GitCommit className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-mono text-[#f8fafc]/70 truncate">
            {c.message}
          </div>
          <div className="text-[10px] font-mono text-[#f8fafc]/30 tracking-wider uppercase">
            @{c.author} · {c.at.slice(0, 10)}
          </div>
        </div>
      </div>
      <code className="text-[10px] font-mono font-bold px-2 py-1 rounded border border-[#7DD3FC]/15 text-[#7DD3FC]/60 bg-[#7DD3FC]/5">
        {c.sha}
      </code>
    </div>
  );
}
