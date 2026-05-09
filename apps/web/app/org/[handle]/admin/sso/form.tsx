"use client";

import { useState, useTransition } from "react";

interface Initial {
  protocol: string;
  issuer: string;
  ssoUrl: string;
  clientId: string;
  emailAttr: string;
  enforced: boolean;
  hasSecret: boolean;
  x509Count: number;
  enabledAt: string | null;
}

export function SsoForm({
  orgHandle,
  initial,
}: {
  orgHandle: string;
  initial: Initial | null;
}) {
  const [protocol, setProtocol] = useState<"oidc" | "saml">(
    (initial?.protocol as "oidc" | "saml") ?? "oidc",
  );
  const [issuer, setIssuer] = useState(
    initial?.protocol === "oidc" ? initial.issuer : "",
  );
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [metadataXml, setMetadataXml] = useState("");
  const [emailAttr, setEmailAttr] = useState(initial?.emailAttr ?? "email");
  const [enforced, setEnforced] = useState(initial?.enforced ?? false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setMsg(null);
    setErr(null);
    start(async () => {
      const body: Record<string, unknown> =
        protocol === "oidc"
          ? { protocol, issuer, clientId, clientSecret, emailAttr, enforced }
          : { protocol, metadataXml, emailAttr, enforced };
      const r = await fetch(`/api/org/${orgHandle}/sso`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        setErr(j.error ?? "save failed");
        return;
      }
      setMsg(
        "Saved. Test the login flow at /api/org/" + orgHandle + "/sso/start.",
      );
      setClientSecret("");
      setMetadataXml("");
    });
  };

  const remove = () => {
    if (!confirm("Disable SSO?")) return;
    start(async () => {
      await fetch(`/api/org/${orgHandle}/sso`, { method: "DELETE" });
      location.reload();
    });
  };

  return (
    <div className="hud-card p-6 space-y-5">
      <div className="flex gap-2 text-xs tracking-[0.18em] uppercase">
        {(["oidc", "saml"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setProtocol(p)}
            className={`px-3 py-1.5 border ${
              protocol === p
                ? "border-cyan-300/60 text-cyan-200 bg-cyan-300/5"
                : "border-sky-300/20 text-sky-300/60"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {protocol === "oidc" ? (
        <>
          <Field
            label="Issuer URL"
            value={issuer}
            setValue={setIssuer}
            placeholder="https://idp.example.com"
          />
          <Field label="Client ID" value={clientId} setValue={setClientId} />
          <Field
            label={
              initial?.hasSecret
                ? "Client secret (leave blank to keep)"
                : "Client secret"
            }
            value={clientSecret}
            setValue={setClientSecret}
            type="password"
          />
        </>
      ) : (
        <label className="block">
          <span className="text-xs tracking-[0.2em] text-sky-300/60 uppercase">
            IdP metadata XML
          </span>
          <textarea
            value={metadataXml}
            onChange={(e) => setMetadataXml(e.target.value)}
            rows={8}
            placeholder="<EntityDescriptor xmlns=...>"
            className="mt-2 w-full bg-black border border-sky-300/20 px-3 py-2 text-sky-100 font-mono text-xs focus:outline-none focus:border-sky-300/60"
          />
        </label>
      )}

      <Field
        label="Email attribute"
        value={emailAttr}
        setValue={setEmailAttr}
      />

      <label className="flex items-center gap-2 text-xs tracking-[0.18em] uppercase text-sky-300/80">
        <input
          type="checkbox"
          checked={enforced}
          onChange={(e) => setEnforced(e.target.checked)}
        />
        Require SSO for all org members
      </label>

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={save}
          disabled={pending}
          className="px-4 py-2 border border-sky-300/40 text-sky-200 text-xs tracking-[0.18em] uppercase hover:bg-sky-300/5 disabled:opacity-50"
        >
          {pending ? "…" : "Save"}
        </button>
        {initial && (
          <button
            onClick={remove}
            disabled={pending}
            className="px-4 py-2 border border-red-400/40 text-red-300 text-xs tracking-[0.18em] uppercase hover:bg-red-400/10 disabled:opacity-50"
          >
            Disable
          </button>
        )}
      </div>

      {initial && (
        <div className="border-t border-sky-300/10 pt-4 space-y-1 text-xs">
          {initial.enabledAt && (
            <p>
              Enabled at{" "}
              <span className="text-sky-100">{initial.enabledAt}</span>
            </p>
          )}
          {initial.protocol === "saml" && (
            <p>
              SAML certs configured:{" "}
              <span className="text-sky-100">{initial.x509Count}</span>
            </p>
          )}
        </div>
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
