"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptForm({
  token,
  orgHandle,
}: {
  token: string;
  orgHandle: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      router.push(`/org/${orgHandle}/admin/members`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="text-xs text-red-300 border border-red-400/30 bg-red-500/5 px-3 py-2">
          {error}
        </div>
      ) : null}
      <button
        onClick={onAccept}
        disabled={busy}
        className="px-5 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10 disabled:opacity-50"
      >
        {busy ? "Joining…" : `Accept and join @${orgHandle}`}
      </button>
    </div>
  );
}
