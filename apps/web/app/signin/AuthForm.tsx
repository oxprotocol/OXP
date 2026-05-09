"use client";

import { useActionState, useState } from "react";
import { LogIn, UserPlus, AlertCircle, Loader2, Code2 } from "lucide-react";
import { signInWithCredentials, signUp, type AuthResult } from "./actions";

export function AuthForm({
  next,
  initialTab,
  oauthError,
}: {
  next: string;
  initialTab: "signin" | "signup";
  oauthError?: string;
}) {
  const [tab, setTab] = useState<"signin" | "signup">(initialTab);
  const ghHref = `/api/verify/github/start?mode=auth&next=${encodeURIComponent(next)}`;

  return (
    <div className="space-y-6">
      {/* GitHub OAuth — same flow handles sign in + sign up + auto-verify. */}
      <a
        href={ghHref}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded text-sm font-mono font-bold tracking-wider uppercase border border-sky-400/40 bg-sky-400/10 text-sky-300 hover:bg-sky-400/20 transition"
      >
        <Code2 className="w-4 h-4" />
        Continue with GitHub
      </a>

      {oauthError && (
        <div className="auth-error flex items-start gap-2.5 px-3 py-2.5 rounded">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="text-sm font-mono leading-snug">{oauthError}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-current opacity-10" />
        <span className="text-xs font-mono uppercase tracking-wider auth-dim">
          or with email
        </span>
        <div className="h-px flex-1 bg-current opacity-10" />
      </div>

      <div
        className="auth-tabs grid grid-cols-2 gap-1 rounded p-1"
        role="tablist"
      >
        <TabButton
          active={tab === "signin"}
          onClick={() => setTab("signin")}
          icon={<LogIn className="w-4 h-4" />}
        >
          Sign in
        </TabButton>
        <TabButton
          active={tab === "signup"}
          onClick={() => setTab("signup")}
          icon={<UserPlus className="w-4 h-4" />}
        >
          Create account
        </TabButton>
      </div>

      {tab === "signin" ? (
        <SignInForm next={next} />
      ) : (
        <SignUpForm next={next} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="auth-tab inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded text-sm font-mono font-bold tracking-wider uppercase transition-colors"
    >
      {icon}
      {children}
    </button>
  );
}

function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<
    AuthResult | undefined,
    FormData
  >(signInWithCredentials, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        invalid={state?.ok === false && state.field === "email"}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        invalid={state?.ok === false && state.field === "password"}
      />

      {state?.ok === false && <ErrorBanner message={state.error} />}

      <SubmitButton pending={pending}>Sign in</SubmitButton>

      <p className="text-xs font-mono text-center auth-dim mt-3">
        <a href="/forgot" className="auth-accent">
          Forgot password?
        </a>
      </p>
    </form>
  );
}

function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<
    AuthResult | undefined,
    FormData
  >(signUp, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field
        label="Handle"
        name="handle"
        type="text"
        autoComplete="username"
        required
        prefix="@"
        placeholder="your-handle"
        invalid={state?.ok === false && state.field === "handle"}
        hint="Lowercase letters, digits, hyphens. 1–40 chars."
      />
      <Field
        label="Display name"
        name="displayName"
        type="text"
        autoComplete="name"
        required
        invalid={state?.ok === false && state.field === "displayName"}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        invalid={state?.ok === false && state.field === "email"}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        invalid={state?.ok === false && state.field === "password"}
        hint="Minimum 8 characters."
      />

      {state?.ok === false && <ErrorBanner message={state.error} />}

      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  required,
  prefix,
  placeholder,
  invalid,
  hint,
  minLength,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
  prefix?: string;
  placeholder?: string;
  invalid?: boolean;
  hint?: string;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="auth-label block text-sm font-mono font-bold tracking-wider uppercase mb-2">
        {label}
      </span>
      <div
        className={`auth-input-wrap flex items-stretch ${
          invalid ? "is-invalid" : ""
        }`}
      >
        {prefix && (
          <span className="auth-input-prefix inline-flex items-center px-3 text-base font-mono">
            {prefix}
          </span>
        )}
        <input
          type={type}
          name={name}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          className="auth-input flex-1 px-3 py-2.5 text-base font-mono focus:outline-none"
        />
      </div>
      {hint && (
        <span className="auth-hint block mt-1.5 text-sm font-mono">{hint}</span>
      )}
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="auth-error flex items-start gap-2.5 px-3 py-2.5 rounded">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="text-sm font-mono leading-snug">{message}</span>
    </div>
  );
}

function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="auth-submit w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded text-base font-mono font-bold tracking-wider uppercase"
    >
      {pending && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}
