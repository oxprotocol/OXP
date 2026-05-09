"use client";

/**
 * Manual code-entry form for /auth/device when the user pasted no `?code=`.
 * Submitting just navigates the page with the (normalized) code in the URL,
 * which renders the approval shell server-side.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CodeForm() {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const compact = value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 8);
        if (compact.length === 0) return;
        const code =
          compact.length === 8
            ? `${compact.slice(0, 4)}-${compact.slice(4)}`
            : compact;
        router.push(`/auth/device?code=${encodeURIComponent(code)}`);
      }}
      className="space-y-4"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ABCD-1234"
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-[#f8fafc]/5 border border-[#f8fafc]/15 rounded px-4 py-3 text-center text-2xl font-mono tracking-widest text-[#7DD3FC] placeholder:text-[#f8fafc]/20 focus:outline-none focus:border-[#7DD3FC]/50"
      />
      <button
        type="submit"
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-sm font-mono text-[#7DD3FC] hover:bg-[#7DD3FC]/15"
      >
        Continue
      </button>
    </form>
  );
}
