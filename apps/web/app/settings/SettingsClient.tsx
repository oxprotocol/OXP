"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Send,
  Shield,
  Trash2,
  UserCircle,
  X,
} from "lucide-react";
import {
  changeEmail,
  changePassword,
  sendPasswordResetLinkToSelf,
  updateProfile,
  type Result,
} from "@/app/settings/actions";
import { Avatar } from "@/components/ui/Avatar";
import type { User } from "@/lib/types";

export function SettingsClient({ user }: { user: User }) {
  return (
    <div className="space-y-8">
      <AvatarSection user={user} />
      <ProfileSection user={user} />
      <EmailSection user={user} />
      <PasswordSection />
      <SecurityLinks />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */
/*  Avatar                                                         */
/* ────────────────────────────────────────────────────────────── */

function AvatarSection({ user }: { user: User }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{
    url: string | null;
    version: string;
  }>({
    url: user.avatarUrl ?? null,
    version: user.avatarUpdatedAt ?? "0",
  });

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/account/avatar", {
        method: "POST",
        body: fd,
      });
      const json: {
        ok?: boolean;
        error?: string;
        avatarUrl?: string;
        avatarUpdatedAt?: string;
      } = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Upload failed.");
        return;
      }
      setOptimistic({
        url: json.avatarUrl ?? null,
        version: json.avatarUpdatedAt ?? String(Date.now()),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/avatar", { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Could not remove avatar.");
        return;
      }
      setOptimistic({ url: null, version: String(Date.now()) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="// Avatar" icon={<Camera className="w-3.5 h-3.5" />}>
      <div className="flex items-center gap-6">
        <Avatar
          url={optimistic.url}
          version={optimistic.version}
          seed={user.avatarSeed}
          size="w-24 h-24"
          textSize="text-3xl"
        />
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/30 bg-[#7DD3FC]/5 text-[#7DD3FC] hover:bg-[#7DD3FC]/10 disabled:opacity-50 transition-all"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5" />
              )}
              Upload
            </button>
            {optimistic.url && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase text-red-300/80 hover:text-red-300 hover:bg-red-500/5 disabled:opacity-50 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-xs font-mono text-[#f8fafc]/40">
            PNG, JPEG, WEBP or GIF · max 2 MB. Square images look best.
          </p>
          {error && <ErrorLine message={error} />}
        </div>
      </div>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── */
/*  Profile                                                        */
/* ────────────────────────────────────────────────────────────── */

function ProfileSection({ user }: { user: User }) {
  const [state, action, pending] = useActionState<Result | undefined, FormData>(
    updateProfile,
    undefined,
  );

  return (
    <Card
      title="// Profile"
      icon={<UserCircle className="w-3.5 h-3.5" />}
      subtitle={`Public on /${user.handle}`}
    >
      <form action={action} className="space-y-4">
        <Field label="Handle" hint="Permanent — contact support to change.">
          <input
            value={`@${user.handle}`}
            readOnly
            className="w-full px-3 py-2 rounded border border-[#7DD3FC]/10 bg-[#060a13]/40 text-sm font-mono text-[#f8fafc]/40 cursor-not-allowed"
          />
        </Field>
        <Field label="Display name" required>
          <input
            name="displayName"
            defaultValue={user.displayName}
            maxLength={80}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Bio" hint="Up to 280 characters.">
          <textarea
            name="bio"
            defaultValue={user.bio ?? ""}
            maxLength={280}
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Location">
            <input
              name="location"
              defaultValue={user.location ?? ""}
              maxLength={80}
              className={inputCls}
              placeholder="Lisbon, PT"
            />
          </Field>
          <Field label="Website">
            <input
              name="website"
              type="url"
              defaultValue={user.website ?? ""}
              className={inputCls}
              placeholder="https://example.com"
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 pt-2">
          <FormStatus state={state} />
          <SubmitButton
            pending={pending}
            icon={<Pencil className="w-3.5 h-3.5" />}
          >
            Save profile
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── */
/*  Email                                                          */
/* ────────────────────────────────────────────────────────────── */

function EmailSection({ user }: { user: User }) {
  const [state, action, pending] = useActionState<Result | undefined, FormData>(
    changeEmail,
    undefined,
  );
  const [editing, setEditing] = useState(false);

  return (
    <Card title="// Email" icon={<Mail className="w-3.5 h-3.5" />}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-mono text-[#f8fafc]/80">{user.email}</p>
            <p className="text-xs font-mono text-[#f8fafc]/40 mt-1">
              Used for sign-in, billing receipts and reset links.
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC]/80 hover:bg-[#7DD3FC]/5 transition-all"
            >
              <Pencil className="w-3 h-3" />
              Change
            </button>
          )}
        </div>

        {editing && (
          <form
            action={action}
            className="space-y-3 pt-3 border-t border-[#7DD3FC]/10"
          >
            <Field
              label="New email"
              hint="You'll need to verify the new address before signing in again."
              required
            >
              <input
                type="email"
                name="email"
                required
                className={inputCls}
                placeholder="you@new-domain.com"
              />
            </Field>
            <div className="flex items-center justify-between gap-4">
              <FormStatus state={state} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-3 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase text-[#f8fafc]/40 hover:text-[#f8fafc]/70 transition-all"
                >
                  Cancel
                </button>
                <SubmitButton
                  pending={pending}
                  icon={<Send className="w-3.5 h-3.5" />}
                >
                  Send verification
                </SubmitButton>
              </div>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── */
/*  Password                                                       */
/* ────────────────────────────────────────────────────────────── */

function PasswordSection() {
  const [state, action, pending] = useActionState<Result | undefined, FormData>(
    changePassword,
    undefined,
  );
  const [linkState, setLinkState] = useState<Result | null>(null);
  const [linkPending, startLink] = useTransition();

  return (
    <Card title="// Password" icon={<KeyRound className="w-3.5 h-3.5" />}>
      <form action={action} className="space-y-4">
        <Field label="Current password" required>
          <input
            type="password"
            name="currentPassword"
            required
            autoComplete="current-password"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="New password" hint="Minimum 8 characters." required>
            <input
              type="password"
              name="newPassword"
              minLength={8}
              required
              autoComplete="new-password"
              className={inputCls}
            />
          </Field>
          <Field label="Confirm new password" required>
            <input
              type="password"
              name="confirmPassword"
              minLength={8}
              required
              autoComplete="new-password"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 pt-2">
          <FormStatus state={state} />
          <SubmitButton
            pending={pending}
            icon={<KeyRound className="w-3.5 h-3.5" />}
          >
            Update password
          </SubmitButton>
        </div>
      </form>

      <div className="mt-6 pt-5 border-t border-[#7DD3FC]/10 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-mono font-bold text-[#f8fafc]/70 tracking-wider uppercase">
            Forgot it?
          </p>
          <p className="text-xs font-mono text-[#f8fafc]/40 mt-1">
            Email yourself a one-hour reset link.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {linkState && <FormStatus state={linkState} />}
          <button
            type="button"
            disabled={linkPending}
            onClick={() =>
              startLink(async () => {
                setLinkState(await sendPasswordResetLinkToSelf());
              })
            }
            className="inline-flex items-center gap-2 px-3 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/20 text-[#7DD3FC]/80 hover:bg-[#7DD3FC]/5 disabled:opacity-50 transition-all"
          >
            {linkPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Email reset link
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── */
/*  Security shortcuts                                             */
/* ────────────────────────────────────────────────────────────── */

function SecurityLinks() {
  return (
    <Card title="// Security" icon={<Shield className="w-3.5 h-3.5" />}>
      <ul className="divide-y divide-[#7DD3FC]/10">
        {[
          {
            href: "/dashboard/security",
            title: "Two-factor authentication",
            desc: "Enroll TOTP and recovery codes.",
          },
          {
            href: "/dashboard/tokens",
            title: "API tokens",
            desc: "Issue and revoke credentials for publishing.",
          },
          {
            href: "/dashboard/orgs",
            title: "Organizations",
            desc: "Manage memberships and roles.",
          },
        ].map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="flex items-center justify-between gap-4 py-3 group"
            >
              <div>
                <p className="text-sm font-mono font-bold text-[#f8fafc]/80 group-hover:text-[#7DD3FC]">
                  {link.title}
                </p>
                <p className="text-xs font-mono text-[#f8fafc]/40 mt-0.5">
                  {link.desc}
                </p>
              </div>
              <span className="text-xs font-mono text-[#7DD3FC]/60 tracking-wider uppercase">
                Manage →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── */
/*  Shared building blocks                                         */
/* ────────────────────────────────────────────────────────────── */

const inputCls =
  "w-full px-3 py-2 rounded border border-[#7DD3FC]/20 bg-[#060a13]/60 text-sm font-mono text-[#f8fafc] placeholder:text-[#f8fafc]/30 focus:border-[#7DD3FC]/50 focus:outline-none focus:ring-1 focus:ring-[#7DD3FC]/30 transition-colors";

function Card({
  title,
  icon,
  subtitle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="hud-card hud-corners p-6">
      <header className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <span className="text-[#7DD3FC]/60">{icon}</span>
          <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/70 uppercase">
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className="text-xs font-mono text-[#f8fafc]/40">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-mono font-bold tracking-wider uppercase text-[#f8fafc]/60 mb-1.5">
        {label}
        {required && <span className="text-[#7DD3FC] ml-1">*</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-xs font-mono text-[#f8fafc]/35 mt-1.5">
          {hint}
        </span>
      )}
    </label>
  );
}

function SubmitButton({
  pending,
  icon,
  children,
}: {
  pending: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function FormStatus({ state }: { state: Result | undefined | null }) {
  if (!state)
    return <span className="text-xs font-mono text-transparent">·</span>;
  if (state.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-300">
        <Check className="w-3.5 h-3.5" />
        {state.message ?? "Saved."}
      </span>
    );
  }
  return <ErrorLine message={state.error} />;
}

function ErrorLine({ message }: { message: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-red-300">
      <X className="w-3.5 h-3.5" />
      {message}
    </span>
  );
}
