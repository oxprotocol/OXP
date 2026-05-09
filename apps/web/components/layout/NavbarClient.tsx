"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Settings,
  User as UserIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import type { User } from "@/lib/types";
import { signOut } from "@/app/signin/actions";

const navLinks: NavItem[] = [
  { label: "Home", href: "/" },
  {
    label: "Extensions",
    href: "/packages",
    children: [
      {
        label: "Browse Registry",
        href: "/packages",
        desc: "All published extensions",
      },
      { label: "Publish Guide", href: "/publish", desc: "Ship your own" },
      {
        label: "Reserve Package Id",
        href: "/new",
        desc: "Claim @you/slug",
        auth: true,
      },
    ],
  },
  { label: "MCP", href: "/mcp" },
  { label: "VSX Mirror", href: "/vsx" },
  {
    label: "Docs",
    href: "/docs",
    children: [
      { label: "Introduction", href: "/docs/introduction" },
      { label: "First Extension", href: "/docs/first-extension" },
      { label: "CLI Reference", href: "/docs/cli-reference" },
      { label: "API Hooks", href: "/docs/api-hooks" },
      { label: "Permissions", href: "/docs/permissions" },
      { label: "Publishing", href: "/docs/publishing" },
    ],
  },
  { label: "Pricing", href: "/pricing" },
  { label: "Community", href: "/community" },
];

interface NavChild {
  label: string;
  href: string;
  desc?: string;
  /** Only show when the user is signed in. */
  auth?: boolean;
}
interface NavItem {
  label: string;
  href: string;
  children?: NavChild[];
}

export function NavbarClient({ user }: { user: User | null }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav
      className="w-full border-b border-[#7DD3FC]/10 bg-[#060a13]/80 backdrop-blur-xl sticky top-0"
      style={{ zIndex: 50 }}
    >
      <div className="h-px w-full bg-linear-to-r from-transparent via-[#7DD3FC]/40 to-transparent" />

      <div className="app-container">
        <div className="flex items-center justify-between h-20">
          <Link
            href="/"
            className="flex items-center transition-opacity hover:opacity-80"
            aria-label="OXP — Open eXtensions Protocol"
          >
            <Logo
              size="md"
              staticText={pathname !== "/"}
              calmCursor={pathname !== "/"}
            />
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              if (link.children && link.children.length > 0) {
                return (
                  <NavDropdown
                    key={link.href}
                    item={link}
                    active={active}
                    isAuthed={!!user}
                  />
                );
              }
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-mono font-medium transition-all duration-300 px-4 py-2 rounded tracking-wider uppercase ${
                    active
                      ? "text-[#7DD3FC] bg-[#7DD3FC]/5"
                      : "text-[#f8fafc]/60 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            {user ? (
              <UserMenu user={user} />
            ) : (
              <>
                <Link
                  href="/signin"
                  className="hidden sm:inline-flex items-center px-4 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase text-[#f8fafc]/50 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5 transition-all"
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex items-center px-5 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
                >
                  Launch
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="h-px w-full bg-linear-to-r from-transparent via-[#7DD3FC]/20 to-transparent" />
    </nav>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded border border-[#7DD3FC]/15 hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-all"
        aria-label="User menu"
      >
        <span className="w-7 h-7 rounded-full overflow-hidden bg-[#7DD3FC]/10 border border-[#7DD3FC]/30 flex items-center justify-center text-xs font-mono font-bold text-[#7DD3FC]">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                user.avatarUpdatedAt
                  ? `${user.avatarUrl}?v=${encodeURIComponent(user.avatarUpdatedAt)}`
                  : user.avatarUrl
              }
              alt={user.displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            initials(user.displayName)
          )}
        </span>
        <span className="hidden sm:inline text-[10px] font-mono font-bold text-[#f8fafc]/70 tracking-wider">
          @{user.handle}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-[#f8fafc]/40 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded border border-[#7DD3FC]/20 bg-[#060a13] shadow-xl shadow-black/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#7DD3FC]/10">
            <div className="text-xs font-mono font-bold text-[#f8fafc]">
              {user.displayName}
            </div>
            <div className="text-[10px] font-mono text-[#7DD3FC]/60">
              @{user.handle}
            </div>
          </div>
          <ul className="py-1">
            <MenuItem
              href={`/${user.handle}`}
              icon={<UserIcon className="w-3.5 h-3.5" />}
              label="Profile"
              onSelect={() => setOpen(false)}
            />
            <MenuItem
              href="/dashboard"
              icon={<LayoutDashboard className="w-3.5 h-3.5" />}
              label="Dashboard"
              onSelect={() => setOpen(false)}
            />
            <MenuItem
              href="/settings"
              icon={<Settings className="w-3.5 h-3.5" />}
              label="Settings"
              onSelect={() => setOpen(false)}
            />
            <MenuItem
              href="/new"
              icon={<Box className="w-3.5 h-3.5" />}
              label="New Extension"
              onSelect={() => setOpen(false)}
            />
          </ul>
          <div className="border-t border-[#7DD3FC]/10 py-1">
            <form action={signOut}>
              <button
                type="submit"
                className="w-full flex items-center gap-2 px-4 py-2 text-xs font-mono text-[#f8fafc]/60 hover:text-red-300 hover:bg-red-500/5 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  href,
  icon,
  label,
  onSelect,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onSelect}
        className="flex items-center gap-2 px-4 py-2 text-xs font-mono text-[#f8fafc]/60 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5 transition-colors"
      >
        {icon}
        {label}
      </Link>
    </li>
  );
}

function NavDropdown({
  item,
  active,
  isAuthed,
}: {
  item: NavItem;
  active: boolean;
  isAuthed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visibleChildren = (item.children ?? []).filter(
    (c) => !c.auth || isAuthed,
  );

  const openNow = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 text-sm font-mono font-medium transition-all duration-300 px-4 py-2 rounded tracking-wider uppercase ${
          active
            ? "text-[#7DD3FC] bg-[#7DD3FC]/5"
            : "text-[#f8fafc]/60 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5"
        }`}
      >
        {item.label}
        <ChevronDown
          className={`w-3 h-3 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-2 w-64 rounded border border-[#7DD3FC]/20 bg-[#060a13] shadow-xl shadow-black/40 overflow-hidden"
        >
          <ul className="py-1">
            <li>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-xs font-mono font-bold tracking-wider uppercase text-[#7DD3FC] hover:bg-[#7DD3FC]/5"
              >
                {item.label} · Overview
              </Link>
            </li>
            <li className="border-t border-[#7DD3FC]/10 my-1" />
            {visibleChildren.map((c) => (
              <li key={c.href}>
                <Link
                  href={c.href}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-xs font-mono text-[#f8fafc]/70 hover:text-[#7DD3FC] hover:bg-[#7DD3FC]/5 transition-colors"
                >
                  <div className="font-bold tracking-wide">{c.label}</div>
                  {c.desc && (
                    <div className="text-[#f8fafc]/40 text-xs mt-0.5">
                      {c.desc}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
