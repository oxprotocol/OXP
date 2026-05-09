"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import {
  claimNamespaceAction,
  releaseNamespaceAction,
  type NamespaceActionResult,
} from "./actions";

export function ClaimForm() {
  const [state, formAction, pending] = useActionState<
    NamespaceActionResult | undefined,
    FormData
  >(claimNamespaceAction, undefined);

  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-[#f8fafc]/40">@</span>
      <input
        name="handle"
        required
        pattern="[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?"
        placeholder="my-side-project"
        disabled={pending}
        className="font-mono text-sm bg-[#060a13] border border-[#7DD3FC]/20 rounded px-3 py-1.5 text-[#f8fafc] placeholder-[#f8fafc]/30 focus:outline-none focus:border-[#7DD3FC]/60 min-w-[260px] disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" /> {pending ? "Claiming…" : "Claim"}
      </button>
      <p className="text-[11px] font-mono text-[#f8fafc]/40 basis-full">
        Lowercase letters, digits, and dashes. Reserved brand handles
        (microsoft, anthropic, …) require manual review.
      </p>
      {state && !state.ok && (
        <p className="text-[11px] font-mono text-[#fca5a5] basis-full">
          {state.error}
        </p>
      )}
      {state && state.ok && (
        <p className="text-[11px] font-mono text-[#86efac] basis-full">
          Namespace claimed.
        </p>
      )}
    </form>
  );
}

export function ReleaseButton({ handle }: { handle: string }) {
  return (
    <form
      action={async (fd) => {
        await releaseNamespaceAction(fd);
      }}
    >
      <input type="hidden" name="handle" value={handle} />
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider text-[#fca5a5] hover:bg-[#fca5a5]/10 border border-[#fca5a5]/20"
      >
        Release
      </button>
    </form>
  );
}
