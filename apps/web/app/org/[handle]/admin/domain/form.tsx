"use client";

import { useState, useTransition } from "react";

interface Initial {
  hostname: string;
  status: string;
  verifyToken: string;
  recordName: string;
  lastError: string | null;
  verifiedAt: string | null;
}

export function DomainForm({
  orgHandle,
  initial,
}: {
  orgHandle: string;
  initial: Initial | null;
}) {
  const [hostname, setHostname] = useState(initial?.hostname ?? "");
  const [state, setState] = useState<Initial | null>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/org/${orgHandle}/domain`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: hostname.trim().toLowerCase() }),
      });
      const j = (await r.json()) as { domain?: Initial; error?: string };
      if (!r.ok) {
        setErr(j.error ?? "save failed");
        return;
      }
      const d = j.domain!;
      setState({
        hostname: d.hostname,
        status: d.status,
        verifyToken: d.verifyToken,
        recordName: d.recordName,
        lastError: null,
        verifiedAt: null,
      });
      setMsg("Saved. Add the TXT record below, then click Verify.");
    });
  };

  const verify = () => {
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/org/${orgHandle}/domain/verify`, {
        method: "POST",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        observed?: string[];
      };
      if (!r.ok || !j.ok) {
        setErr(j.error ?? "verification failed");
        if (j.observed)
          setErr(
            (prev) => `${prev} (observed: ${j.observed!.join(", ") || "none"})`,
          );
        return;
      }
      setMsg("Verified. CNAME the hostname to edge.oxp.sh to start serving.");
      setState((s) =>
        s
          ? { ...s, status: "verified", verifiedAt: new Date().toISOString() }
          : s,
      );
    });
  };

  const remove = () => {
    if (!confirm("Remove custom domain?")) return;
    start(async () => {
      const r = await fetch(`/api/org/${orgHandle}/domain`, {
        method: "DELETE",
      });
      if (r.ok) {
        setState(null);
        setHostname("");
        setMsg("Removed.");
      }
    });
  };

  return (
    <div className="hud-card p-6 space-y-4">
      <label className="block text-xs tracking-[0.2em] text-sky-300/60 uppercase">
        Hostname
        <input
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="oxp.your-co.com"
          className="mt-2 w-full bg-black border border-sky-300/20 px-3 py-2 text-sky-100 font-mono text-sm focus:outline-none focus:border-sky-300/60"
        />
      </label>
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={save}
          disabled={pending || !hostname}
          className="px-4 py-2 border border-sky-300/40 text-sky-200 text-xs tracking-[0.18em] uppercase hover:bg-sky-300/5 disabled:opacity-50"
        >
          {pending ? "…" : state ? "Update" : "Save"}
        </button>
        {state && (
          <>
            <button
              onClick={verify}
              disabled={pending}
              className="px-4 py-2 border border-cyan-300/60 text-cyan-200 text-xs tracking-[0.18em] uppercase hover:bg-cyan-300/10 disabled:opacity-50"
            >
              Verify DNS
            </button>
            <button
              onClick={remove}
              disabled={pending}
              className="px-4 py-2 border border-red-400/40 text-red-300 text-xs tracking-[0.18em] uppercase hover:bg-red-400/10 disabled:opacity-50"
            >
              Remove
            </button>
          </>
        )}
      </div>

      {state && (
        <div className="border-t border-sky-300/10 pt-4 space-y-3 text-xs">
          <Row label="Status" value={state.status.toUpperCase()} />
          <Row label="TXT record name" value={state.recordName} mono />
          <Row label="TXT record value" value={state.verifyToken} mono />
          {state.verifiedAt && (
            <Row label="Verified at" value={state.verifiedAt} />
          )}
          {state.lastError && (
            <Row label="Last error" value={state.lastError} />
          )}
        </div>
      )}

      {msg && <p className="text-xs text-cyan-300">{msg}</p>}
      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <span className="text-sky-300/50 tracking-[0.18em] uppercase text-[10px]">
        {label}
      </span>
      <span
        className={mono ? "font-mono text-sky-100 break-all" : "text-sky-100"}
      >
        {value}
      </span>
    </div>
  );
}
