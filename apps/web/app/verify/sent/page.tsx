/**
 * /verify/sent — "check your inbox" landing after signup, plus a resend
 * form for when the email never arrives.
 */
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { resendVerification, type SimpleResult } from "../../signin/actions";

export default function VerifySentPage() {
  const [state, action, pending] = useActionState<
    SimpleResult | undefined,
    FormData
  >(resendVerification, undefined);

  return (
    <main className="mx-auto max-w-md px-6 py-20 font-mono text-sky-200">
      <div className="hud-card px-8 py-10 text-center">
        <Mail className="w-10 h-10 mx-auto text-sky-300 mb-4" />
        <h1 className="text-xl tracking-[0.18em] uppercase mb-3 text-sky-100">
          Check your inbox
        </h1>
        <p className="text-sm text-sky-300/70 mb-6">
          We sent a verification link. Click it to activate your account and
          sign in. The link expires in 24 hours.
        </p>

        <form action={action} className="space-y-3 text-left">
          <label className="block text-[10px] tracking-[0.2em] uppercase text-sky-300/60">
            Didn&apos;t arrive? Re-send to
          </label>
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="w-full px-3 py-2 bg-sky-950/30 border border-sky-300/20 text-sky-100 placeholder-sky-300/30 focus:outline-none focus:border-sky-300/50"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10 disabled:opacity-50"
          >
            {pending ? "Sending…" : "Resend verification"}
          </button>
          {state?.ok ? (
            <p className="text-xs text-emerald-300">
              If that address has an unverified account, a new link is on the
              way.
            </p>
          ) : null}
          {state && !state.ok ? (
            <p className="text-xs text-red-300">{state.error}</p>
          ) : null}
        </form>

        <p className="mt-6 text-xs text-sky-300/50">
          Back to{" "}
          <Link href="/signin" className="text-sky-300 hover:text-sky-100">
            sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
