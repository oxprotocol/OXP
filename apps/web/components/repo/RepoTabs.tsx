"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  FolderTree,
  History,
  Settings as SettingsIcon,
} from "lucide-react";

interface RepoTab {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  ownersOnly?: boolean;
}

export function RepoTabs({
  ownerHandle,
  slug,
  isOwner,
}: {
  ownerHandle: string;
  slug: string;
  isOwner: boolean;
}) {
  const pathname = usePathname();
  const base = `/${ownerHandle}/${slug}`;

  const tabs: RepoTab[] = [
    { label: "Overview", href: base, icon: Box },
    { label: "Files", href: `${base}/files`, icon: FolderTree },
    { label: "Versions", href: `${base}/versions`, icon: History },
    {
      label: "Settings",
      href: `${base}/settings`,
      icon: SettingsIcon,
      ownersOnly: true,
    },
  ];

  return (
    <div className="flex items-center gap-1 -mb-[1px] overflow-x-auto">
      {tabs
        .filter((t) => !t.ownersOnly || isOwner)
        .map((t) => {
          const active =
            t.href === base
              ? pathname === base
              : pathname === t.href || pathname.startsWith(`${t.href}/`);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`inline-flex items-center gap-2 px-5 py-4 text-sm font-mono font-bold tracking-wider uppercase border-b-2 transition-colors ${
                active
                  ? "border-[#7DD3FC] text-[#7DD3FC]"
                  : "border-transparent text-[#f8fafc]/50 hover:text-[#7DD3FC]"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </Link>
          );
        })}
    </div>
  );
}
