/**
 * /forgot — request a password-reset email.
 */
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { requestPasswordReset, type SimpleResult } from "../signin/actions";

export default function ForgotPage() {
  const [state, action, pending] = useActionState<
    SimpleResult | undefined,
    FormData
  >(requestPasswordReset, undefined);

  return (
    <main className="mx-auto max-w-md px-6 py-20 font-mono text-sky-200">
      <div className="hud-card px-8 py-10">
        <div className="text-center mb-6">
          <KeyRound className="w-10 h-10 mx-auto text-sky-300 mb-3" />
          <h1 className="text-xl tracking-[0.18em] uppercase text-sky-100">
            Reset password
          </h1>
          <p className="text-xs text-sky-300/70 mt-2">
            Enter your account email. We&apos;ll send a reset link valid for one
            hour.
          </p>
        </div>

        <form action={action} className="space-y-3">
          <input
            type="email"
            name="email"
            required
            autoFocus
            placeholder="you@example.com"
            className="w-full px-3 py-2 bg-sky-950/30 border border-sky-300/20 text-sky-100 placeholder-sky-300/30 focus:outline-none focus:border-sky-300/50"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10 disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send reset link"}
          </button>
          {state?.ok ? (
            <p className="text-xs text-emerald-300 text-center">
              If that email matches an account, a reset link is on its way.
            </p>
          ) : null}
          {state && !state.ok ? (
            <p className="text-xs text-red-300 text-center">{state.error}</p>
          ) : null}
        </form>

        <p className="mt-6 text-center text-xs text-sky-300/50">
          Remembered it?{" "}
          <Link href="/signin" className="text-sky-300 hover:text-sky-100">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
