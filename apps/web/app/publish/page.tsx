import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Package,
  ShieldCheck,
  Terminal,
  Upload,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publish" };

/**
 * /publish — public landing for "how do I ship an extension?".
 *
 * Reservation actually happens at `/new` (server action `createExtension`).
 * The actual bundle upload happens via the CLI (`oxp publish`). This page
 * stitches the two together so the user always knows what to do next.
 */
export default async function PublishPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const me = await getCurrentUser();
  const sp = await searchParams;
  if (me && sp.next === "reserve") redirect("/new");

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center gap-3 mb-3">
            <Upload className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Publish"}
            </h2>
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[#f8fafc] mb-2">
            Ship your extension
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40 max-w-2xl">
            Reserve your package id, then push from the CLI. The registry
            verifies your manifest, stores the signed bundle, and serves it to
            every conformant IDE.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
        <div className="space-y-6">
          <Step
            n={1}
            title="Sign in"
            done={!!me}
            body={
              me ? (
                <p className="text-xs font-mono text-[#f8fafc]/50">
                  Signed in as{" "}
                  <span className="text-[#7DD3FC]">@{me.handle}</span>.
                </p>
              ) : (
                <Link
                  href="/signin?next=/publish"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
                >
                  Sign in <ArrowRight className="w-3 h-3" />
                </Link>
              )
            }
          />

          <Step
            n={2}
            title="Reserve a package id"
            done={false}
            body={
              <div className="space-y-3">
                <p className="text-xs font-mono text-[#f8fafc]/50">
                  Claims{" "}
                  <code className="text-[#7DD3FC]/70">
                    @{me?.handle ?? "you"}/your-slug
                  </code>{" "}
                  in the global namespace.
                </p>
                <Link
                  href={me ? "/new" : "/signin?next=/new"}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all"
                >
                  <Package className="w-3.5 h-3.5" /> Reserve id
                </Link>
              </div>
            }
          />

          <Step
            n={3}
            title="Push your bundle from the CLI"
            done={false}
            body={
              <div className="bg-[#030711] rounded p-4 border border-[#7DD3FC]/8 space-y-2">
                <code className="block text-xs font-mono text-[#f8fafc]/60">
                  <span className="text-[#7DD3FC]/40">$</span> npm i -g oxp
                </code>
                <code className="block text-xs font-mono text-[#f8fafc]/60">
                  <span className="text-[#7DD3FC]/40">$</span> oxp login
                </code>
                <code className="block text-xs font-mono text-[#f8fafc]/60">
                  <span className="text-[#7DD3FC]/40">$</span> oxp publish
                </code>
              </div>
            }
          />
        </div>

        <div className="space-y-6">
          <div className="hud-card hud-corners p-6">
            <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase mb-4 flex items-center gap-2">
              <Terminal className="w-3 h-3" />
              {"// Requirements"}
            </h3>
            <ul className="space-y-2 text-xs font-mono text-[#f8fafc]/60 list-disc list-inside">
              <li>Signed oxp.config.ts</li>
              <li>Semver-compatible version</li>
              <li>Valid permissions block</li>
              <li>Passes `oxp doctor`</li>
            </ul>
          </div>

          <div className="hud-card hud-corners p-6">
            <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase mb-3 flex items-center gap-2">
              <ShieldCheck className="w-3 h-3" />
              {"// Hardening"}
            </h3>
            <p className="text-xs font-mono text-[#f8fafc]/55 leading-relaxed">
              Optional 2FA gate enforced at publish for accounts with TOTP
              enrolled. Manage at{" "}
              <Link
                href="/dashboard/security"
                className="text-[#7DD3FC] hover:text-[#BAE6FD]"
              >
                /dashboard/security
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  done,
}: {
  n: number;
  title: string;
  body: React.ReactNode;
  done: boolean;
}) {
  return (
    <div className="hud-card hud-corners p-6">
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`w-7 h-7 rounded border flex items-center justify-center text-xs font-mono font-bold ${
            done
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-[#7DD3FC]/30 bg-[#7DD3FC]/5 text-[#7DD3FC]"
          }`}
        >
          {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
        </span>
        <h3 className="text-sm font-bold text-[#f8fafc]">{title}</h3>
      </div>
      {body}
    </div>
  );
}
