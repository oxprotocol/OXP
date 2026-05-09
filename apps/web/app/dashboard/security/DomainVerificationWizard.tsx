"use client";

/**
 * Level 3 · Domain — self-serve wizard.
 *
 * 1. User enters apex domain.
 * 2. Server creates a `PublisherVerification(method=dns_txt, status=pending)`
 *    row and returns the host + expected TXT value.
 * 3. UI shows the record, user adds it to their DNS provider.
 * 4. "Check now" calls `runDomainCheck` which resolves DNS server-side.
 * 5. On success, server marks `verified` and recomputes publisher level.
 *    Page revalidates → trust badge flips to Level 3.
 *
 * Reserved-brand handles (anthropic, microsoft, …) are gated server-side:
 * `createDnsChallenge` rejects any domain that isn't the brand's canonical
 * one. The UI surfaces that as an inline error.
 */

import { useActionState, useState, useTransition } from "react";
import {
  Loader2,
  Globe,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  startDomainVerification,
  runDomainCheck,
  revokeDomainVerification,
  type StartDomainResult,
  type DomainCheckResult,
  type ActionResult,
} from "./actions";

export interface PendingVerification {
  id: string;
  target: string;
  host: string;
  expectedRecord: string;
  expiresAt: string;
  status: string;
  reason: string | null;
}

export interface VerifiedVerification {
  id: string;
  target: string;
  verifiedAt: string;
}

export function DomainVerificationWizard({
  handle,
  reserved,
  reservedDomain,
  pending,
  verified,
  defaultDomain,
}: {
  handle: string;
  reserved: boolean;
  /** Required apex domain when `reserved` is true (e.g. "anthropic.com"). */
  reservedDomain: string | null;
  pending: PendingVerification[];
  verified: VerifiedVerification[];
  /** Pre-fill the input (e.g. coming from the claim page). */
  defaultDomain?: string;
}) {
  return (
    <div className="space-y-4">
      {verified.map((v) => (
        <VerifiedRow key={v.id} v={v} />
      ))}
      {pending.map((v) => (
        <PendingRow key={v.id} v={v} />
      ))}
      <StartForm
        handle={handle}
        reserved={reserved}
        reservedDomain={reservedDomain}
        defaultDomain={defaultDomain}
      />
    </div>
  );
}

function StartForm({
  handle,
  reserved,
  reservedDomain,
  defaultDomain,
}: {
  handle: string;
  reserved: boolean;
  reservedDomain: string | null;
  defaultDomain?: string;
}) {
  const [state, action, isPending] = useActionState<
    StartDomainResult | undefined,
    FormData
  >(startDomainVerification, undefined);

  // Once a verification is created we surface it as a PendingRow on the next
  // server render. Until that happens, show an inline panel from the action
  // result (so the user sees the TXT record without a flash).
  if (state?.ok) {
    return (
      <PendingRow
        v={{
          ...state.verification,
          reason: null,
        }}
      />
    );
  }

  return (
    <form
      action={action}
      className="rounded border border-(--auth-card-br) bg-(--auth-card-bg) p-4 space-y-3"
    >
      <p className="auth-heading text-xs font-mono uppercase tracking-wider">
        {reserved ? `Verify ${reservedDomain}` : "Add a domain"}
      </p>
      <p className="auth-muted text-xs font-mono leading-relaxed">
        {reserved ? (
          <>
            <code>@{handle}</code> is a reserved brand. The only domain accepted
            is <code>{reservedDomain}</code>.
          </>
        ) : (
          <>
            We&rsquo;ll generate a one-time TXT record for you to publish on{" "}
            <code>_oxp-challenge.&lt;your-domain&gt;</code>.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2 items-stretch">
        <input
          name="domain"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder={reserved ? (reservedDomain ?? "") : "acme.com"}
          defaultValue={
            defaultDomain ?? (reserved ? (reservedDomain ?? "") : "")
          }
          readOnly={reserved}
          className="auth-input flex-1 min-w-[200px] px-3 py-2 rounded font-mono text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="auth-submit inline-flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
          Start verification
        </button>
      </div>
      {state && !state.ok ? (
        <p className="text-xs font-mono text-red-400 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function PendingRow({ v }: { v: PendingVerification }) {
  const [copiedHost, setCopiedHost] = useState(false);
  const [copiedValue, setCopiedValue] = useState(false);
  const [checkState, checkAction, checking] = useActionState<
    DomainCheckResult | undefined,
    FormData
  >(runDomainCheck, undefined);
  const [, revokeAction, revoking] = useActionState<
    ActionResult | undefined,
    FormData
  >(revokeDomainVerification, undefined);

  const expires = new Date(v.expiresAt);
  const daysLeft = Math.max(
    0,
    Math.ceil((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  const copy = async (
    text: string,
    setter: (b: boolean) => void,
  ): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="rounded border border-[#7DD3FC]/30 bg-[#7DD3FC]/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-[#7DD3FC]" />
        <h4 className="auth-heading text-sm font-bold">Pending · {v.target}</h4>
        <span className="ml-auto text-xs font-mono auth-dim">
          expires in {daysLeft}d
        </span>
      </div>
      <p className="auth-muted text-xs font-mono leading-relaxed">
        Add the following TXT record at your DNS provider, then click{" "}
        <strong>Check now</strong>. Propagation usually takes seconds, sometimes
        a few minutes.
      </p>

      <div className="space-y-2">
        <FieldRow label="Type" value="TXT" copyable={false} />
        <FieldRow
          label="Name"
          value={v.host}
          copyable
          copied={copiedHost}
          onCopy={() => copy(v.host, setCopiedHost)}
        />
        <FieldRow
          label="Value"
          value={v.expectedRecord}
          copyable
          copied={copiedValue}
          onCopy={() => copy(v.expectedRecord, setCopiedValue)}
        />
      </div>

      {checkState?.ok ? (
        <div className="rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-mono text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Verified. Refresh the page to see the Level 3 badge.
        </div>
      ) : checkState && !checkState.ok ? (
        <div className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-mono text-amber-300 space-y-1">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{checkState.error}</span>
          </div>
          {checkState.observedRecords &&
          checkState.observedRecords.length > 0 ? (
            <div className="auth-dim">
              Observed at <code>{v.host}</code>:{" "}
              {checkState.observedRecords.map((r, i) => (
                <code key={i} className="ml-1">
                  {r}
                </code>
              ))}
            </div>
          ) : (
            <div className="auth-dim">
              No TXT records found at <code>{v.host}</code>.
            </div>
          )}
        </div>
      ) : v.reason ? (
        <div className="text-xs font-mono auth-dim">Last check: {v.reason}</div>
      ) : null}

      <div className="flex gap-2 flex-wrap">
        <form action={checkAction}>
          <input type="hidden" name="verificationId" value={v.id} />
          <button
            type="submit"
            disabled={checking}
            className="auth-submit inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase disabled:opacity-50"
          >
            {checking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Check now
          </button>
        </form>
        <form action={revokeAction}>
          <input type="hidden" name="verificationId" value={v.id} />
          <button
            type="submit"
            disabled={revoking}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono auth-dim hover:text-red-400 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

function VerifiedRow({ v }: { v: VerifiedVerification }) {
  const [, revokeAction, revoking] = useActionState<
    ActionResult | undefined,
    FormData
  >(revokeDomainVerification, undefined);
  return (
    <div className="rounded border border-emerald-400/30 bg-emerald-400/5 p-4 flex items-center gap-3">
      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="auth-heading text-sm font-bold">
          Verified · <code>{v.target}</code>
        </p>
        <p className="auth-dim text-xs font-mono">
          {new Date(v.verifiedAt).toLocaleString()}
        </p>
      </div>
      <form action={revokeAction}>
        <input type="hidden" name="verificationId" value={v.id} />
        <button
          type="submit"
          disabled={revoking}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono auth-dim hover:text-red-400 disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
          Revoke
        </button>
      </form>
    </div>
  );
}

function FieldRow({
  label,
  value,
  copyable,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyable: boolean;
  copied?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="auth-dim text-xs font-mono uppercase tracking-wider w-14 shrink-0 pt-1">
        {label}
      </span>
      <code className="flex-1 min-w-0 break-all rounded bg-black/40 px-3 py-2 text-xs font-mono auth-heading">
        {value}
      </code>
      {copyable && onCopy ? (
        <button
          type="button"
          onClick={onCopy}
          className="auth-dim hover:auth-accent inline-flex items-center gap-1 text-xs font-mono shrink-0 pt-2"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
    </div>
  );
}
