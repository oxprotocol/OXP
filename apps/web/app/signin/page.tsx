import Link from "next/link";
import { LogIn } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "./AuthForm";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    mode?: string;
    error?: string;
    verified?: string;
    reset?: string;
  }>;
}) {
  const {
    next = "/dashboard",
    mode = "signin",
    error,
    verified,
    reset,
  } = await searchParams;
  // Use the DB-backed check (not raw `auth()`): a stale session cookie
  // pointing at a deleted user would otherwise redirect to /dashboard,
  // which would bounce back here, causing ERR_TOO_MANY_REDIRECTS.
  const me = await getCurrentUser();
  if (me) redirect(next);

  const initialTab: "signin" | "signup" =
    mode === "signup" ? "signup" : "signin";

  return (
    <div
      className="signin-shell flex flex-col flex-1 w-full items-center justify-center py-20 px-4"
      style={{ zIndex: 2 }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="auth-icon-tile p-3 rounded inline-flex mb-4">
            <LogIn className="w-6 h-6" />
          </div>
          <h1 className="auth-heading text-3xl font-black mb-2">
            Sign in to OXP
          </h1>
          <p className="auth-muted text-base font-mono">
            Manage your extensions, view stats, and publish releases.
          </p>
        </div>

        <div className="auth-card p-8">
          {verified ? (
            <div className="mb-4 px-3 py-2 text-xs font-mono text-emerald-200 border border-emerald-400/30 bg-emerald-500/5 rounded">
              Email verified. Sign in below to continue.
            </div>
          ) : null}
          {reset ? (
            <div className="mb-4 px-3 py-2 text-xs font-mono text-emerald-200 border border-emerald-400/30 bg-emerald-500/5 rounded">
              Password updated. Sign in with your new password.
            </div>
          ) : null}
          <AuthForm next={next} initialTab={initialTab} oauthError={error} />
        </div>

        <p className="auth-dim text-center text-sm font-mono mt-6">
          Need a tour first?{" "}
          <Link href="/launch" className="auth-accent">
            See the dashboard demo
          </Link>
        </p>
      </div>
    </div>
  );
}
