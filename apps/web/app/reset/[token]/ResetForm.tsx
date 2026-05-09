"use client";

import { useActionState } from "react";
import { resetPassword, type SimpleResult } from "../../signin/actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<
    SimpleResult | undefined,
    FormData
  >(resetPassword, undefined);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input
        type="password"
        name="password"
        required
        minLength={8}
        autoFocus
        placeholder="New password (min 8 chars)"
        className="w-full px-3 py-2 bg-sky-950/30 border border-sky-300/20 text-sky-100 placeholder-sky-300/30 focus:outline-none focus:border-sky-300/50"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Set new password"}
      </button>
      {state && !state.ok ? (
        <p className="text-xs text-red-300 text-center">{state.error}</p>
      ) : null}
    </form>
  );
}
