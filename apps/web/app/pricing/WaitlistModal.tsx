"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, Check, Mail, Sparkles, User, X } from "lucide-react";
import { joinWaitlist } from "./actions";

interface Props {
  planId: "pro" | "teams";
  planName: string;
  buttonLabel: string;
  /** When true the button uses the primary filled style (Pro card). */
  highlight?: boolean;
}

export function WaitlistModal({
  planId,
  planName,
  buttonLabel,
  highlight,
}: Props) {
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Focus the email field when the modal opens.
  useEffect(() => {
    if (open && !success) emailRef.current?.focus();
  }, [open, success]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  function openModal() {
    setSuccess(false);
    setError(null);
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await joinWaitlist({}, fd);
      if (result.success) {
        setSuccess(true);
        formRef.current?.reset();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <>
      {/* ─── CTA Button ─── */}
      <button
        type="button"
        onClick={openModal}
        className={`block w-full text-center px-4 py-3 rounded text-sm font-mono font-bold tracking-wider uppercase transition-all ${
          highlight
            ? "bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] hover:shadow-[0_0_24px_-4px_rgba(125,211,252,0.6)]"
            : "border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10"
        }`}
      >
        {buttonLabel}
      </button>

      {/* ─── Modal ─── */}
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="waitlist-heading"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Card */}
          <div className="relative w-full max-w-md hud-card hud-corners p-8 animate-float"
            style={{ animationDuration: "0s" }}
          >
            {/* Top scan line */}
            <div className="absolute top-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-[#7DD3FC]/60 to-transparent animate-pulse-glow" />

            {/* Close */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-1 text-[#f8fafc]/30 hover:text-[#7DD3FC] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            {success ? (
              <SuccessView planName={planName} onClose={() => setOpen(false)} />
            ) : (
              <FormView
                planId={planId}
                planName={planName}
                formRef={formRef}
                emailRef={emailRef}
                onSubmit={handleSubmit}
                isPending={isPending}
                error={error}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Form view ────────────────────────────────────────────────────────────────

function FormView({
  planId,
  planName,
  formRef,
  emailRef,
  onSubmit,
  isPending,
  error,
}: {
  planId: string;
  planName: string;
  formRef: React.RefObject<HTMLFormElement | null>;
  emailRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5 text-[#7DD3FC]/60" />
          <span className="text-[9px] font-mono font-bold tracking-[0.25em] text-[#7DD3FC]/60 uppercase">
            Early Access · {planName}
          </span>
        </div>
        <h2
          id="waitlist-heading"
          className="text-xl font-black text-[#f8fafc] mb-2 leading-tight"
        >
          Lock in your{" "}
          <span className="text-holo">40% discount</span>
        </h2>
        <p className="text-xs font-mono text-[#f8fafc]/45 leading-relaxed">
          Drop your email and we'll reach out the moment{" "}
          <span className="text-[#7DD3FC]/70">{planName}</span> billing goes live
          — with your early-adopter rate locked in.
        </p>
      </div>

      {/* Form */}
      <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
        <input type="hidden" name="plan" value={planId} />

        {/* Email */}
        <div className="relative">
          <label
            htmlFor={`wl-email-${planId}`}
            className="block text-[9px] font-mono font-bold tracking-[0.2em] text-[#f8fafc]/40 uppercase mb-1.5"
          >
            Email *
          </label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#7DD3FC]/40 pointer-events-none" />
            <input
              ref={emailRef}
              id={`wl-email-${planId}`}
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              className="w-full pl-10 pr-4 py-2.5 bg-[#030711] border border-[#7DD3FC]/15 rounded text-sm font-mono text-[#f8fafc] placeholder-[#f8fafc]/20 focus:border-[#7DD3FC]/50 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Name (optional) */}
        <div>
          <label
            htmlFor={`wl-name-${planId}`}
            className="block text-[9px] font-mono font-bold tracking-[0.2em] text-[#f8fafc]/40 uppercase mb-1.5"
          >
            Name <span className="text-[#f8fafc]/20 normal-case font-normal">(optional)</span>
          </label>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#7DD3FC]/40 pointer-events-none" />
            <input
              id={`wl-name-${planId}`}
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Your name or company"
              className="w-full pl-10 pr-4 py-2.5 bg-[#030711] border border-[#7DD3FC]/15 rounded text-sm font-mono text-[#f8fafc] placeholder-[#f8fafc]/20 focus:border-[#7DD3FC]/50 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs font-mono text-red-400 bg-red-500/5 border border-red-500/20 rounded px-3 py-2">
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded bg-[#7DD3FC] text-[#060a13] text-sm font-mono font-bold tracking-wider uppercase hover:bg-[#BAE6FD] hover:shadow-[0_0_24px_-4px_rgba(125,211,252,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <span className="inline-block w-3.5 h-3.5 border-2 border-[#060a13]/30 border-t-[#060a13] rounded-full animate-spin" />
          ) : (
            <>
              Claim my spot
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>

        <p className="text-center text-[10px] font-mono text-[#f8fafc]/25 leading-relaxed">
          No spam. We'll email you once, when billing opens.
        </p>
      </form>
    </>
  );
}

// ─── Success view ─────────────────────────────────────────────────────────────

function SuccessView({
  planName,
  onClose,
}: {
  planName: string;
  onClose: () => void;
}) {
  return (
    <div className="py-4 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full border border-emerald-500/30 bg-emerald-500/10 mb-5">
        <Check className="w-7 h-7 text-emerald-400" />
      </div>
      <h2 className="text-xl font-black text-[#f8fafc] mb-2">
        You&apos;re on the list.
      </h2>
      <p className="text-xs font-mono text-[#f8fafc]/45 leading-relaxed mb-6 max-w-xs mx-auto">
        We&apos;ll email you when{" "}
        <span className="text-[#7DD3FC]/80">{planName}</span> billing goes live
        with your <span className="text-emerald-400">40% early-adopter discount</span> locked in.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 hover:text-[#7DD3FC] uppercase transition-colors"
      >
        Close
      </button>
    </div>
  );
}
