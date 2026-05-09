import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "OXP | Open eXtensions Protocol",
    template: "OXP | %s",
  },
  description:
    "The universal package registry for IDE extensions. Build once, run anywhere.",
};

// The root layout reads the auth session (cookies) via Navbar.getCurrentUser().
// That's a dynamic operation, so the whole tree must be rendered per-request.
// Without this, Next 16 tries to statically prerender the synthetic
// /_not-found and /_global-error pages and crashes inside Navbar.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        {/* Synchronous theme bootstrap. Loaded from /public via a regular
         * script tag so React 19 / Next 16 don't emit the
         * "scripts in components don't execute on client" warning that any
         * inline <script> or next/script with inline body triggers in head. */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body className="min-h-full flex flex-col bg-[#060a13] text-[#f8fafc] relative overflow-x-hidden">
        {/* Subtle grid overlay across entire page */}
        <div
          className="fixed inset-0 grid-overlay pointer-events-none"
          style={{ zIndex: 1 }}
        />

        <Navbar />
        <main className="flex-1 flex flex-col relative" style={{ zIndex: 2 }}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
