import Link from "next/link";
import {
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  Home,
} from "lucide-react";
import type { RepoEntry } from "@/lib/repos";

interface BreadcrumbProps {
  ownerHandle: string;
  slug: string;
  segments: string[];
}

export function FileBreadcrumbs({
  ownerHandle,
  slug,
  segments,
}: BreadcrumbProps) {
  const base = `/${ownerHandle}/${slug}/files`;
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-sm font-mono">
      <Link
        href={base}
        className="flex items-center gap-1.5 text-[#7DD3FC] hover:text-[#7DD3FC] font-semibold"
      >
        <Home className="w-3.5 h-3.5" />
        {slug}
      </Link>
      {segments.map((seg, i) => {
        const href = `${base}/${segments.slice(0, i + 1).join("/")}`;
        const last = i === segments.length - 1;
        return (
          <span key={href} className="flex items-center gap-1.5">
            <ChevronRight className="w-3.5 h-3.5 text-[#f8fafc]/40" />
            {last ? (
              <span className="text-[#f8fafc]">{seg}</span>
            ) : (
              <Link
                href={href}
                className="text-[#7DD3FC] hover:text-[#7DD3FC] font-semibold"
              >
                {seg}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface DirListingProps {
  ownerHandle: string;
  slug: string;
  parentPath: string; // "" at root
  entries: RepoEntry[];
}

function formatSize(bytes?: number): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DirListing({
  ownerHandle,
  slug,
  parentPath,
  entries,
}: DirListingProps) {
  const base = `/${ownerHandle}/${slug}/files`;

  return (
    <div className="hud-card hud-corners overflow-hidden">
      {parentPath && (
        <Link
          href={
            parentPath.includes("/")
              ? `${base}/${parentPath.split("/").slice(0, -1).join("/")}`
              : base
          }
          className="flex items-center gap-3 px-6 py-3.5 border-b border-[#7DD3FC]/10 text-sm font-mono text-[#7DD3FC] hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5 font-semibold"
        >
          <FolderIcon className="w-4 h-4" />
          ..
        </Link>
      )}
      {entries.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm font-mono text-[#f8fafc]/50">
          Empty directory.
        </div>
      ) : (
        <ul>
          {entries.map((e, i) => {
            const Icon = e.kind === "dir" ? FolderIcon : FileIcon;
            const tone =
              e.kind === "dir"
                ? "text-[#7DD3FC] font-semibold"
                : "text-[#f8fafc]";
            return (
              <li key={e.path}>
                <Link
                  href={`${base}/${e.path}`}
                  className={`flex items-center justify-between gap-3 px-6 py-3.5 hover:bg-[#7DD3FC]/5 transition-colors ${
                    i > 0 ? "border-t border-[#7DD3FC]/5" : ""
                  }`}
                >
                  <span className="flex items-center gap-3 text-sm font-mono">
                    <Icon
                      className={`w-4 h-4 ${e.kind === "dir" ? "text-[#7DD3FC]" : "text-[#f8fafc]/55"}`}
                    />
                    <span className={tone}>{e.name}</span>
                  </span>
                  <span className="text-xs font-mono text-[#f8fafc]/55 tracking-wider uppercase">
                    {e.kind === "dir" ? "Dir" : formatSize(e.size)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
