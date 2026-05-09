"use client";

import { useState, useTransition } from "react";

interface Initial {
  provider: string;
  keyRef: string;
  region: string;
  algorithm: string;
  publicKeyPem: string | null;
  hasCreds: boolean;
  enabledAt: string | null;
  lastError: string | null;
}

const PROVIDERS = ["aws_kms", "gcp_kms", "azure_kv", "hashicorp_vault"];
const ALGOS = ["ecdsa_p256_sha256", "rsa_pss_sha256"];

export function KmsForm({
  orgHandle,
  initial,
}: {
  orgHandle: string;
  initial: Initial | null;
}) {
  const [provider, setProvider] = useState(initial?.provider ?? "aws_kms");
  const [keyRef, setKeyRef] = useState(initial?.keyRef ?? "");
  const [region, setRegion] = useState(initial?.region ?? "us-east-1");
  const [algorithm, setAlgorithm] = useState(
    initial?.algorithm ?? "ecdsa_p256_sha256",
  );
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setMsg(null);
    setErr(null);
    start(async () => {
      const body: Record<string, unknown> = {
        provider,
        keyRef,
        region,
        algorithm,
      };
      if (accessKeyId && secretAccessKey) {
        body.credentials = {
          accessKeyId,
          secretAccessKey,
          sessionToken: sessionToken || undefined,
        };
      }
      const r = await fetch(`/api/org/${orgHandle}/kms`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { kms?: unknown; error?: string };
      if (!r.ok) {
        setErr(j.error ?? "save failed");
        return;
      }
      setMsg(
        "Saved + GetPublicKey succeeded. Future publishes will use this key.",
      );
      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
    });
  };

  const remove = () => {
    if (
      !confirm(
        "Detach KMS key? Future publishes fall back to platform Sigstore.",
      )
    )
      return;
    start(async () => {
      await fetch(`/api/org/${orgHandle}/kms`, { method: "DELETE" });
      location.reload();
    });
  };

  return (
    <div className="hud-card p-6 space-y-4">
      <Select
        label="Provider"
        value={provider}
        setValue={setProvider}
        options={PROVIDERS}
      />
      <Field
        label="Key ref (ARN / resource ID)"
        value={keyRef}
        setValue={setKeyRef}
        placeholder="arn:aws:kms:us-east-1:111…:key/xxxx"
      />
      <Field label="Region" value={region} setValue={setRegion} />
      <Select
        label="Algorithm"
        value={algorithm}
        setValue={setAlgorithm}
        options={ALGOS}
      />

      {provider === "aws_kms" && (
        <fieldset className="border border-sky-300/10 p-4 space-y-3">
          <legend className="px-2 text-[10px] tracking-[0.2em] text-sky-300/60 uppercase">
            AWS credentials {initial?.hasCreds ? "(leave blank to keep)" : ""}
          </legend>
          <Field
            label="Access key ID"
            value={accessKeyId}
            setValue={setAccessKeyId}
          />
          <Field
            label="Secret access key"
            value={secretAccessKey}
            setValue={setSecretAccessKey}
            type="password"
          />
          <Field
            label="Session token (optional)"
            value={sessionToken}
            setValue={setSessionToken}
            type="password"
          />
        </fieldset>
      )}

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={pending || !keyRef}
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

      {initial?.publicKeyPem && (
        <details className="text-xs">
          <summary className="cursor-pointer text-sky-300/60 tracking-[0.18em] uppercase">
            Cached public key (SPKI PEM)
          </summary>
          <pre className="mt-2 bg-black/40 p-3 text-[10px] text-sky-200 overflow-x-auto">
            {initial.publicKeyPem}
          </pre>
        </details>
      )}

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

function Select({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="text-xs tracking-[0.2em] text-sky-300/60 uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-2 w-full bg-black border border-sky-300/20 px-3 py-2 text-sky-100 font-mono text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
