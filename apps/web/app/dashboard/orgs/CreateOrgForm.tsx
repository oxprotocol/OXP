"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateOrgForm() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim(),
          displayName: displayName.trim(),
          website: website.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        handle?: string;
      };
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      router.push(`/org/${json.handle}/admin/members`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div className="text-xs font-mono text-red-300 border border-red-400/30 bg-red-500/5 px-3 py-2">
          {error}
        </div>
      ) : null}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#7DD3FC]/60">
          Handle
          <div className="mt-1 flex items-center bg-black/40 border border-[#7DD3FC]/20 focus-within:border-[#7DD3FC]/50">
            <span className="px-3 text-[#f8fafc]/40 font-mono">@</span>
            <input
              required
              pattern="[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="acme-co"
              className="flex-1 bg-transparent py-2 pr-3 text-sm font-mono text-[#f8fafc] outline-none"
            />
          </div>
        </label>
        <label className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#7DD3FC]/60">
          Display name
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Acme Co"
            maxLength={80}
            className="mt-1 w-full bg-black/40 border border-[#7DD3FC]/20 px-3 py-2 text-sm font-mono text-[#f8fafc] focus:border-[#7DD3FC]/50 outline-none"
          />
        </label>
      </div>
      <label className="block text-[10px] font-mono tracking-[0.2em] uppercase text-[#7DD3FC]/60">
        Website (optional)
        <input
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://acme.co"
          className="mt-1 w-full bg-black/40 border border-[#7DD3FC]/20 px-3 py-2 text-sm font-mono text-[#f8fafc] focus:border-[#7DD3FC]/50 outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="px-5 py-2 text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
