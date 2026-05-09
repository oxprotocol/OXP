"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";
import {
  disableTwoFactor,
  startEnrollment,
  verifyEnrollment,
  type ActionResult,
} from "./actions";

interface Enrollment {
  secret: string;
  uri: string;
  qrDataUrl: string;
  recoveryCodes: string[];
}

export function TwoFactorPanel({
  enrolled,
  enrolledAt,
  remainingRecoveryCodes,
}: {
  enrolled: boolean;
  enrolledAt: string | null;
  remainingRecoveryCodes: number;
}) {
  if (enrolled) {
    return (
      <DisableCard
        enrolledAt={enrolledAt}
        remainingRecoveryCodes={remainingRecoveryCodes}
      />
    );
  }
  return <EnrollCard />;
}

function EnrollCard() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const begin = () => {
    setStartError(null);
    startTransition(async () => {
      const r = await startEnrollment();
      if (r.ok) setEnrollment(r.enrollment);
      else setStartError(r.error);
    });
  };

  return (
    <div className="hud-card hud-corners p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-3">
        <ShieldOff className="w-5 h-5 text-[#7DD3FC]/60" />
        <h2 className="auth-heading text-base font-mono font-bold tracking-wider uppercase">
          Two-factor authentication: off
        </h2>
      </div>
      <p className="auth-muted text-sm font-mono mb-6">
        Add a TOTP authenticator (1Password, Authy, Google Authenticator) to
        require a 6-digit code on every publish.
      </p>

      {!enrollment ? (
        <>
          <button
            type="button"
            onClick={begin}
            disabled={isPending}
            className="auth-submit inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-bold tracking-wider uppercase disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            Enable 2FA
          </button>
          {startError ? (
            <p className="text-xs font-mono text-red-400 mt-3">{startError}</p>
          ) : null}
        </>
      ) : (
        <EnrollmentForm enrollment={enrollment} />
      )}
    </div>
  );
}

function EnrollmentForm({ enrollment }: { enrollment: Enrollment }) {
  const [state, action, isPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(verifyEnrollment, undefined);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  if (state?.ok) {
    return (
      <div className="border border-[#7DD3FC]/40 bg-[#7DD3FC]/5 rounded p-4">
        <p className="auth-accent text-sm font-mono font-bold flex items-center gap-2">
          <Check className="w-4 h-4" /> 2FA enabled. Refresh the page.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6">
      <div>
        <p className="auth-dim text-xs font-mono uppercase tracking-wider mb-2">
          1. Scan QR or paste secret into your authenticator
        </p>
        <div className="border border-(--auth-card-br) rounded p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrDataUrl}
              alt="2FA enrollment QR code"
              width={160}
              height={160}
              className="rounded border border-(--auth-card-br) bg-[#f8fafc] p-2 shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-3">
              <p className="auth-dim text-xs font-mono">
                Scan with 1Password, Authy, Google Authenticator, etc. If your
                authenticator can&rsquo;t scan, paste the secret below.
              </p>
              <code className="block font-mono text-xs break-all auth-muted">
                {enrollment.uri}
              </code>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm auth-heading break-all">
                  {enrollment.secret}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(enrollment.secret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 2000);
                  }}
                  className="auth-dim hover:auth-accent inline-flex items-center gap-1 text-xs font-mono shrink-0"
                >
                  {copiedSecret ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedSecret ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="auth-dim text-xs font-mono uppercase tracking-wider mb-2">
          2. Save these recovery codes — shown once
        </p>
        <div className="border border-(--auth-card-br) rounded p-4">
          <div className="grid grid-cols-2 gap-2 font-mono text-sm auth-heading mb-3">
            {enrollment.recoveryCodes.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(
                enrollment.recoveryCodes.join("\n"),
              );
              setCopiedCodes(true);
              setTimeout(() => setCopiedCodes(false), 2000);
            }}
            className="auth-dim hover:auth-accent inline-flex items-center gap-1 text-xs font-mono"
          >
            {copiedCodes ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedCodes ? "Copied" : "Copy all"}
          </button>
        </div>
      </div>

      <div>
        <label className="block">
          <span className="auth-dim text-xs font-mono uppercase tracking-wider mb-2 block">
            3. Enter the 6-digit code from your authenticator
          </span>
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            className="auth-input w-40 px-3 py-2 rounded font-mono tracking-widest text-center"
          />
        </label>
        <input type="hidden" name="secret" value={enrollment.secret} />
        <input
          type="hidden"
          name="recoveryCodes"
          value={enrollment.recoveryCodes.join(",")}
        />
      </div>

      {state && !state.ok ? (
        <p className="text-xs font-mono text-red-400">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="auth-submit inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-bold tracking-wider uppercase disabled:opacity-50"
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Confirm and enable
      </button>
    </form>
  );
}

function DisableCard({
  enrolledAt,
  remainingRecoveryCodes,
}: {
  enrolledAt: string | null;
  remainingRecoveryCodes: number;
}) {
  const [state, action, isPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(disableTwoFactor, undefined);

  return (
    <div className="hud-card hud-corners p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-3">
        <ShieldCheck className="w-5 h-5 text-[#7DD3FC]" />
        <h2 className="auth-heading text-base font-mono font-bold tracking-wider uppercase">
          Two-factor authentication: on
        </h2>
      </div>
      <p className="auth-muted text-sm font-mono mb-2">
        Enabled{" "}
        {enrolledAt ? new Date(enrolledAt).toLocaleDateString() : "previously"}.
        Every <code className="font-mono">oxp publish</code> now requires a
        fresh code via <code className="font-mono">oxp 2fa proof</code>.
      </p>
      <p className="auth-dim text-xs font-mono mb-6">
        {remainingRecoveryCodes} recovery code
        {remainingRecoveryCodes === 1 ? "" : "s"} remaining.
      </p>

      <form action={action} className="space-y-4">
        <label className="block">
          <span className="auth-dim text-xs font-mono uppercase tracking-wider mb-2 block">
            Enter a current code or recovery code to disable
          </span>
          <input
            name="code"
            type="text"
            autoComplete="one-time-code"
            required
            placeholder="000000"
            className="auth-input w-64 px-3 py-2 rounded font-mono"
          />
        </label>
        {state && !state.ok ? (
          <p className="text-xs font-mono text-red-400">{state.error}</p>
        ) : null}
        {state?.ok ? (
          <p className="text-xs font-mono auth-accent">2FA disabled.</p>
        ) : null}
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-bold tracking-wider uppercase border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Disable 2FA
        </button>
      </form>
    </div>
  );
}
