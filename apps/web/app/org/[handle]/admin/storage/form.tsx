"use client";

import { useState, useTransition } from "react";

interface Initial {
  provider: string;
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  sseKmsKeyId: string;
  prefix: string;
  hasSecret: boolean;
  enabledAt: string | null;
  lastError: string | null;
}

const PROVIDERS = ["s3", "r2", "minio", "azure_blob", "gcs"];

export function StorageForm({
  orgHandle,
  initial,
}: {
  orgHandle: string;
  initial: Initial | null;
}) {
  const [provider, setProvider] = useState(initial?.provider ?? "s3");
  const [bucket, setBucket] = useState(initial?.bucket ?? "");
  const [region, setRegion] = useState(initial?.region ?? "us-east-1");
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? "");
  const [accessKeyId, setAccessKeyId] = useState(initial?.accessKeyId ?? "");
  const [secret, setSecret] = useState("");
  const [sseKmsKeyId, setSseKmsKeyId] = useState(initial?.sseKmsKeyId ?? "");
  const [prefix, setPrefix] = useState(initial?.prefix ?? "oxp/");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/org/${orgHandle}/storage`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          bucket: bucket.trim(),
          region: region.trim(),
          endpoint: endpoint.trim() || null,
          accessKeyId: accessKeyId.trim(),
          secret,
          sseKmsKeyId: sseKmsKeyId.trim() || null,
          prefix: prefix.trim(),
        }),
      });
      const j = (await r.json()) as { storage?: unknown; error?: string };
      if (!r.ok) {
        setErr(j.error ?? "save failed");
        return;
      }
      setMsg(
        "Saved + smoke-test passed. New blobs will be pushed to your bucket.",
      );
      setSecret("");
    });
  };

  const remove = () => {
    if (
      !confirm(
        "Detach storage backend? Existing blobs in your bucket are NOT deleted; new blobs will land on the platform default.",
      )
    )
      return;
    start(async () => {
      await fetch(`/api/org/${orgHandle}/storage`, { method: "DELETE" });
      location.reload();
    });
  };

  return (
    <div className="hud-card p-6 space-y-4">
      <label className="block">
        <span className="text-xs tracking-[0.2em] text-sky-300/60 uppercase">
          Provider
        </span>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="mt-2 w-full bg-black border border-sky-300/20 px-3 py-2 text-sky-100 font-mono text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <Field label="Bucket" value={bucket} setValue={setBucket} />
      <Field
        label="Region"
        value={region}
        setValue={setRegion}
        placeholder="us-east-1"
      />
      {provider !== "s3" && (
        <Field
          label="Endpoint"
          value={endpoint}
          setValue={setEndpoint}
          placeholder="https://<account>.r2.cloudflarestorage.com"
        />
      )}
      <Field
        label="Access key ID"
        value={accessKeyId}
        setValue={setAccessKeyId}
      />
      <Field
        label={
          initial?.hasSecret
            ? "Secret access key (leave blank to keep)"
            : "Secret access key"
        }
        value={secret}
        setValue={setSecret}
        type="password"
      />
      <Field
        label="SSE-KMS key (optional)"
        value={sseKmsKeyId}
        setValue={setSseKmsKeyId}
      />
      <Field label="Object prefix" value={prefix} setValue={setPrefix} />

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={pending || !bucket}
          className="px-4 py-2 border border-cyan-300/60 text-cyan-200 text-xs tracking-[0.18em] uppercase hover:bg-cyan-300/10 disabled:opacity-50"
        >
          {pending ? "Testing…" : "Save + smoke test"}
        </button>
        {initial && (
          <button
            onClick={remove}
            disabled={pending}
            className="px-4 py-2 border border-red-400/40 text-red-300 text-xs tracking-[0.18em] uppercase hover:bg-red-400/10"
          >
            Detach
          </button>
        )}
      </div>

      {initial?.enabledAt && (
        <p className="text-xs text-sky-300/60">
          Enabled at <span className="text-sky-100">{initial.enabledAt}</span>
        </p>
      )}
      {initial?.lastError && (
        <p className="text-xs text-red-300">Last error: {initial.lastError}</p>
      )}
      {msg && <p className="text-xs text-cyan-300">{msg}</p>}
      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  setValue,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs tracking-[0.2em] text-sky-300/60 uppercase">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full bg-black border border-sky-300/20 px-3 py-2 text-sky-100 font-mono text-sm focus:outline-none focus:border-sky-300/60"
      />
    </label>
  );
}
