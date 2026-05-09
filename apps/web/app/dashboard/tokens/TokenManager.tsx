"use client";

import { useActionState, useState, useTransition } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Plus,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { createToken, revokeToken, type CreateTokenResult } from "./actions";

export interface TokenSummary {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

type ScopeMode = "namespace" | "package" | "custom";

export function TokenManager({
  tokens,
  userHandle,
}: {
  tokens: TokenSummary[];
  userHandle: string;
}) {
  const [showCreate, setShowCreate] = useState(tokens.length === 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="auth-heading text-base font-mono font-bold tracking-wider uppercase">
            Active tokens ({tokens.length})
          </h2>
          {!showCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="auth-submit inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-bold tracking-wider uppercase"
            >
              <Plus className="w-4 h-4" /> New token
            </button>
          )}
        </div>

        {tokens.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {tokens.map((t) => (
              <TokenRow key={t.id} token={t} />
            ))}
          </ul>
        )}
      </div>

      <aside>
        {showCreate ? (
          <CreateTokenForm
            userHandle={userHandle}
            onCancel={
              tokens.length > 0 ? () => setShowCreate(false) : undefined
            }
          />
        ) : (
          <HelpCard />
        )}
      </aside>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="auth-card p-10 text-center">
      <p className="auth-muted text-sm font-mono mb-2">No tokens yet.</p>
      <p className="auth-dim text-xs font-mono">
        Create a token on the right to authenticate{" "}
        <code className="font-mono">oxp login</code>.
      </p>
    </div>
  );
}

function HelpCard() {
  return (
    <div className="auth-card p-6 space-y-4">
      <h3 className="auth-heading text-sm font-mono font-bold tracking-wider uppercase">
        Using a token
      </h3>
      <ol className="auth-muted text-xs font-mono space-y-2 list-decimal list-inside">
        <li>
          Click <span className="auth-accent">New token</span>.
        </li>
        <li>Copy the token value (shown once).</li>
        <li>
          Run{" "}
          <code className="font-mono auth-accent">
            oxp login --token &lt;value&gt;
          </code>{" "}
          on your machine.
        </li>
      </ol>
      <p className="auth-dim text-xs font-mono leading-relaxed">
        Lost a token? Revoke it here, then mint a new one. Rotation from the CLI
        is also supported via{" "}
        <code className="font-mono">oxp tokens rotate</code>.
      </p>
    </div>
  );
}

function TokenRow({ token }: { token: TokenSummary }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const expired = token.expiresAt && new Date(token.expiresAt) < new Date();

  function onRevoke() {
    setError(null);
    start(async () => {
      const r = await revokeToken(token.id);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <li className="auth-card p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="auth-heading font-mono font-bold text-sm">
              {token.name}
            </span>
            {expired && (
              <span className="auth-error text-xs font-mono px-2 py-0.5 rounded">
                Expired
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {token.scopes.map((s) => (
              <span
                key={s}
                className="auth-tab text-xs font-mono px-2 py-0.5 rounded"
                style={{
                  background: "var(--auth-accent-bg)",
                  color: "var(--auth-accent)",
                  borderColor: "var(--auth-accent-br)",
                }}
              >
                {s}
              </span>
            ))}
          </div>
          <dl className="grid grid-cols-3 gap-3 text-xs font-mono">
            <Meta label="Created" value={fmt(token.createdAt)} />
            <Meta
              label="Last used"
              value={token.lastUsedAt ? fmt(token.lastUsedAt) : "Never"}
            />
            <Meta
              label="Expires"
              value={token.expiresAt ? fmt(token.expiresAt) : "Never"}
            />
          </dl>
        </div>
        <div className="flex flex-col items-end gap-2">
          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRevoke}
                disabled={pending}
                className="auth-submit inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono font-bold uppercase"
                style={{
                  background: "var(--auth-error-fg)",
                  borderColor: "var(--auth-error-fg)",
                  color: "#fff",
                }}
              >
                {pending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                Confirm revoke
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="auth-tab inline-flex items-center px-3 py-1.5 rounded text-xs font-mono uppercase"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="auth-tab inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono uppercase"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Revoke
            </button>
          )}
          {error && (
            <span className="auth-error text-xs font-mono px-2 py-1 rounded inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="auth-dim text-xs uppercase tracking-wider">{label}</dt>
      <dd className="auth-muted text-xs">{value}</dd>
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function CreateTokenForm({
  userHandle,
  onCancel,
}: {
  userHandle: string;
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState<
    CreateTokenResult | undefined,
    FormData
  >(createToken, undefined);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("namespace");

  if (state?.ok) {
    return <RevealedToken token={state.token} onDone={onCancel} />;
  }

  return (
    <div className="auth-card p-6">
      <h3 className="auth-heading text-sm font-mono font-bold tracking-wider uppercase mb-4">
        New token
      </h3>
      <form action={action} className="space-y-4">
        <FieldText
          label="Name"
          name="name"
          placeholder="laptop, ci-pipeline, …"
          required
          maxLength={200}
        />

        <fieldset className="space-y-2">
          <legend className="auth-label block text-xs font-mono font-bold tracking-wider uppercase mb-2">
            Scope
          </legend>
          <ScopeRadio
            value="namespace"
            checked={scopeMode === "namespace"}
            onChange={setScopeMode}
            title="Whole namespace"
            sub={`publish:@${userHandle}/*`}
          />
          <ScopeRadio
            value="package"
            checked={scopeMode === "package"}
            onChange={setScopeMode}
            title="Single package"
            sub="Limit to one slug"
          />
          <ScopeRadio
            value="custom"
            checked={scopeMode === "custom"}
            onChange={setScopeMode}
            title="Custom scopes"
            sub="Comma- or space-separated"
          />

          {scopeMode === "package" && (
            <div className="auth-input-wrap mt-2 flex items-stretch">
              <span className="auth-input-prefix inline-flex items-center px-3 text-sm font-mono">
                @{userHandle}/
              </span>
              <input
                type="text"
                name="packageSlug"
                pattern="[a-z0-9][a-z0-9-]*"
                required
                placeholder="my-extension"
                className="auth-input flex-1 px-3 py-2 text-sm font-mono focus:outline-none"
              />
            </div>
          )}

          {scopeMode === "custom" && (
            <div className="auth-input-wrap mt-2">
              <textarea
                name="customScopes"
                required
                rows={3}
                placeholder={`publish:@${userHandle}/foo, publish:@${userHandle}/bar`}
                className="auth-input block w-full px-3 py-2 text-sm font-mono focus:outline-none resize-none"
              />
            </div>
          )}
        </fieldset>

        <FieldText
          label="Expires in (days)"
          name="ttlDays"
          type="number"
          defaultValue="90"
          min={1}
          max={365}
          required
        />

        <input type="hidden" name="scopeMode" value={scopeMode} />

        {state?.ok === false && (
          <div className="auth-error flex items-start gap-2 px-3 py-2 rounded">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="text-xs font-mono">{state.error}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="auth-submit flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-mono font-bold tracking-wider uppercase"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create token
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="auth-tab inline-flex items-center px-4 py-2.5 rounded text-sm font-mono uppercase"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ScopeRadio({
  value,
  checked,
  onChange,
  title,
  sub,
}: {
  value: ScopeMode;
  checked: boolean;
  onChange: (v: ScopeMode) => void;
  title: string;
  sub: string;
}) {
  return (
    <label
      className={`auth-input-wrap flex items-start gap-3 px-3 py-2.5 cursor-pointer ${
        checked ? "is-invalid" : ""
      }`}
      style={
        checked
          ? {
              borderColor: "var(--auth-accent-br)",
              background: "var(--auth-accent-bg)",
            }
          : undefined
      }
    >
      <input
        type="radio"
        name="scopeMode_radio"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-1 accent-(--auth-accent)"
      />
      <span className="flex-1 min-w-0">
        <span className="auth-heading block text-sm font-mono font-bold">
          {title}
        </span>
        <span className="auth-muted block text-xs font-mono truncate">
          {sub}
        </span>
      </span>
    </label>
  );
}

function FieldText({
  label,
  name,
  type = "text",
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  maxLength?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="auth-label block text-xs font-mono font-bold tracking-wider uppercase mb-2">
        {label}
      </span>
      <div className="auth-input-wrap flex items-stretch">
        <input
          type={type}
          name={name}
          {...rest}
          className="auth-input flex-1 px-3 py-2 text-sm font-mono focus:outline-none"
        />
      </div>
    </label>
  );
}

function RevealedToken({
  token,
  onDone,
}: {
  token: string;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="auth-card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Check
          className="w-5 h-5 mt-0.5"
          style={{ color: "var(--auth-accent)" }}
        />
        <div>
          <h3 className="auth-heading text-sm font-mono font-bold tracking-wider uppercase">
            Token created
          </h3>
          <p className="auth-muted text-xs font-mono mt-1">
            This is the only time you&apos;ll see the full value. Copy it now.
          </p>
        </div>
      </div>

      <div className="auth-input-wrap flex items-stretch">
        <input
          type={shown ? "text" : "password"}
          readOnly
          value={token}
          className="auth-input flex-1 px-3 py-2 text-xs font-mono focus:outline-none"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "Hide token" : "Show token"}
          className="auth-tab inline-flex items-center px-3"
        >
          {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={copy}
          className="auth-tab inline-flex items-center gap-1 px-3 text-xs font-mono uppercase"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" /> Copy
            </>
          )}
        </button>
      </div>

      <div className="auth-input-wrap p-3">
        <p className="auth-dim text-xs font-mono mb-1">Use it like:</p>
        <code className="auth-input block text-xs font-mono break-all">
          oxp login --token {shown ? token : "<paste-token-here>"}
        </code>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="auth-submit w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-mono font-bold tracking-wider uppercase"
      >
        Done
      </button>
    </div>
  );
}
