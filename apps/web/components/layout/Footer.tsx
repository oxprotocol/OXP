import React from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Logo } from "@/components/brand/Logo";

// Lucide removed brand glyphs (Github, Twitter, …) in v0.418+. We inline
// the marks here so we don't pull in a second icon dependency.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .5C5.73.5.67 5.56.67 11.83c0 5.01 3.24 9.26 7.74 10.76.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.1-3.15.69-3.81-1.34-3.81-1.34-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.51-.29-5.16-1.26-5.16-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.16.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.66 5.31-5.18 5.59.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.2.66.79.55 4.49-1.5 7.73-5.75 7.73-10.76C23.33 5.56 18.27.5 12 .5z" />
    </svg>
  );
}

function DiscordMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

const sections = [
  {
    title: "Platform",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "CLI Reference", href: "/docs/cli-reference" },
      { label: "SDK Reference", href: "/docs/sdk" },
      { label: "Specification", href: "/docs/introduction" },
    ],
  },
  {
    title: "Registry",
    links: [
      { label: "Browse Extensions", href: "/packages" },
      { label: "Publish", href: "/publish" },
      { label: "MCP Servers", href: "/mcp" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "/legal/terms" },
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Refund Policy", href: "/legal/refund" },
      { label: "Trust & Compliance", href: "/trust" },
      { label: "Uptime SLA", href: "/sla" },
      { label: "System Status", href: "/status" },
      { label: "Security", href: "/docs/permissions" },
    ],
  },
];

const bottomNav = [
  { label: "Privacy", href: "/legal/privacy" },
  { label: "Terms", href: "/legal/terms" },
  { label: "Refunds", href: "/legal/refund" },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="w-full mt-auto relative" style={{ zIndex: 2 }}>
      <div className="h-px w-full bg-linear-to-r from-transparent via-[#7DD3FC]/20 to-transparent" />

      <div className="app-container py-12">
        {/* Bordered HUD card containing the entire footer body */}
        <div className="hud-card hud-corners p-8 md:p-10">
          {/* ── Top: brand + description + socials ── */}
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8 pb-8 border-b border-[#7DD3FC]/10">
            <div className="flex items-start gap-4 max-w-xl">
              <Link
                href="/"
                aria-label="OXP — Open eXtensions Protocol"
                className="shrink-0 transition-opacity hover:opacity-80 mt-1"
              >
                <Logo size="md" staticText />
              </Link>
              <p className="text-sm text-[#f8fafc]/55 font-mono leading-relaxed">
                The Open eXtensions Protocol. Build once, run anywhere — VS
                Code, JetBrains, Neovim, Piye. WASM-sandboxed, signed, and open
                from spec to runtime.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/oxprotocol"
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded border border-[#7DD3FC]/15 hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-all text-[#f8fafc]/50 hover:text-[#7DD3FC]"
                aria-label="GitHub"
              >
                <GithubMark className="w-4 h-4" />
              </a>
              <Link
                href="/community"
                className="p-2 rounded border border-[#7DD3FC]/15 hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-all text-[#f8fafc]/50 hover:text-[#7DD3FC]"
                aria-label="Community"
              >
                <MessageCircle className="w-4 h-4" />
              </Link>
              <Link
                href="/community"
                className="p-2 rounded border border-[#7DD3FC]/15 hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-all text-[#f8fafc]/50 hover:text-[#7DD3FC]"
                aria-label="Discord"
              >
                <DiscordMark className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* ── Middle: link columns ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 py-10">
            {sections.map((section) => (
              <div key={section.title}>
                <h4 className="font-mono text-xs font-bold tracking-[0.22em] text-[#7DD3FC] uppercase mb-5">
                  {section.title}
                </h4>
                <ul className="space-y-3">
                  {section.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-[#f8fafc]/55 hover:text-[#7DD3FC] transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* ── Bottom: copyright + secondary nav + status ── */}
          <div className="pt-6 border-t border-[#7DD3FC]/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <p className="text-xs text-[#f8fafc]/40 font-mono tracking-wider">
                &copy; {year} OXP Protocol &middot; Open spec, signed runtime
              </p>
              <p className="text-xs text-[#f8fafc]/40 font-mono">
                Contact:{" "}
                <a
                  href="mailto:hello@oxp.sh"
                  className="hover:text-[#7DD3FC] transition-colors"
                >
                  hello@oxp.sh
                </a>
              </p>
            </div>
            <div className="flex items-center gap-5">
              <nav className="flex items-center gap-4">
                {bottomNav.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-xs font-mono text-[#f8fafc]/40 hover:text-[#7DD3FC] transition-colors"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
              <div className="flex items-center gap-2 pl-4 border-l border-[#7DD3FC]/10">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-beacon" />
                <span className="text-xs text-emerald-500/70 font-mono tracking-wider uppercase">
                  Online
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
