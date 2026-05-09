"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRightLeft,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  deleteRepo,
  renameRepo,
  setVisibility,
  transferOwnership,
} from "./actions";

interface Props {
  ownerHandle: string;
  slug: string;
  visibility: "public" | "private";
  fullId: string; // ownerHandle/slug
}

function Section({
  title,
  description,
  children,
  danger,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`hud-card hud-corners p-8 space-y-6 ${danger ? "border-red-500/40" : ""}`}
    >
      <div>
        <h2
          className={`text-[10px] font-mono font-bold tracking-[0.2em] uppercase mb-2 ${
            danger ? "text-red-400/80" : "text-[#7DD3FC]/60"
          }`}
        >
          {title}
        </h2>
        <p className="text-xs font-mono text-[#f8fafc]/40 leading-relaxed">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

function Pill({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${
        on
          ? "border-amber-300/40 text-amber-200/80 bg-amber-300/10"
          : "border-[#7DD3FC]/15 text-[#7DD3FC]/60 bg-[#7DD3FC]/5"
      }`}
    >
      {children}
    </span>
  );
}

export function SettingsForm({ ownerHandle, slug, visibility, fullId }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vis, setVis] = useState(visibility);
  const [newSlug, setNewSlug] = useState(slug);
  const [transferTo, setTransferTo] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onToggleVisibility = () => {
    const next = vis === "public" ? "private" : "public";
    setError(null);
    start(async () => {
      try {
        await setVisibility(ownerHandle, slug, next);
        setVis(next);
        router.refresh();
      } catch (e) {
        setError(humanise(e));
      }
    });
  };

  const onRename = () => {
    setError(null);
    start(async () => {
      try {
        await renameRepo(ownerHandle, slug, newSlug);
        router.refresh();
      } catch (e) {
        setError(humanise(e));
      }
    });
  };

  const onTransfer = () => {
    setError(null);
    start(async () => {
      try {
        await transferOwnership(ownerHandle, slug, transferTo);
        router.refresh();
      } catch (e) {
        setError(humanise(e));
      }
    });
  };

  const onDelete = () => {
    setError(null);
    start(async () => {
      try {
        await deleteRepo(ownerHandle, slug, confirm);
        router.push("/dashboard");
      } catch (e) {
        setError(humanise(e));
      }
    });
  };

  const goingPrivate = vis === "public";

  return (
    <div className="space-y-6">
      {error && (
        <div className="hud-card hud-corners px-5 py-3 border-red-500/40 text-xs font-mono text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      <Section
        title="// Visibility"
        description="Public extensions appear in the registry and can be installed by anyone. Private extensions are visible only to you and your collaborators."
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {vis === "public" ? (
              <Eye className="w-4 h-4 text-emerald-400" />
            ) : (
              <EyeOff className="w-4 h-4 text-[#f8fafc]/50" />
            )}
            <span className="text-sm font-mono text-[#f8fafc]/80 capitalize">
              {vis}
            </span>
            {vis === "private" && <Pill on>Pro</Pill>}
          </div>
          <button
            onClick={onToggleVisibility}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-[10px] font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10 disabled:opacity-50"
          >
            {pending && <Loader2 className="w-3 h-3 animate-spin" />}
            {goingPrivate ? "Make Private" : "Make Public"}
          </button>
        </div>
        {goingPrivate && (
          <p className="text-[10px] font-mono text-amber-200/70 leading-relaxed">
            Going private requires an OXP Pro plan. The toggle is wired but
            won&apos;t enforce until billing ships.
          </p>
        )}
      </Section>

      <Section
        title="// Rename"
        description="Change the extension slug. Old install ids continue to redirect via aliases."
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center bg-[#030711] rounded border border-[#7DD3FC]/15 px-3 py-2 text-xs font-mono text-[#f8fafc]/40 gap-1">
            <span>@{ownerHandle}/</span>
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="bg-transparent text-[#f8fafc] focus:outline-none min-w-0 flex-1"
            />
          </div>
          <button
            onClick={onRename}
            disabled={pending || newSlug === slug || !newSlug.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-[10px] font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10 disabled:opacity-30"
          >
            <Pencil className="w-3 h-3" /> Rename
          </button>
        </div>
      </Section>

      <Section
        title="// Transfer Ownership"
        description="Move this extension to another user or organization. The new owner must accept."
      >
        <div className="flex items-center gap-3 flex-wrap">
          <input
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            placeholder="new-owner-handle"
            className="bg-[#030711] rounded border border-[#7DD3FC]/15 px-3 py-2 text-xs font-mono text-[#f8fafc] focus:outline-none focus:border-[#7DD3FC]/40 placeholder-[#f8fafc]/20 flex-1 min-w-[200px]"
          />
          <button
            onClick={onTransfer}
            disabled={pending || !transferTo.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-[10px] font-mono font-bold tracking-wider uppercase border border-[#7DD3FC]/30 text-[#7DD3FC] hover:bg-[#7DD3FC]/10 disabled:opacity-30"
          >
            <ArrowRightLeft className="w-3 h-3" /> Transfer
          </button>
        </div>
      </Section>

      <Section
        title="// Danger Zone"
        description="Deleting an extension removes it from the registry, archives all versions, and frees the slug after 7 days. This cannot be undone."
        danger
      >
        <div>
          <label className="block text-xs font-mono text-[#f8fafc]/55 uppercase tracking-wider mb-2">
            Type <span className="text-red-400 font-bold">{fullId}</span> to
            confirm
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={fullId}
              className="bg-[#030711] rounded border border-red-500/40 px-3 py-2 text-sm font-mono text-[#f8fafc] focus:outline-none focus:border-red-500 placeholder-[#f8fafc]/20 flex-1 min-w-[200px]"
            />
            <button
              onClick={onDelete}
              disabled={pending || confirm !== fullId}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded text-xs font-mono font-bold tracking-wider uppercase bg-red-600 text-white border border-red-700 hover:bg-red-700 disabled:bg-red-600/40 disabled:border-red-600/40 disabled:text-white/70 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Extension
            </button>
          </div>
        </div>
      </Section>

      <div className="flex items-center gap-2 text-xs font-mono text-[#f8fafc]/55">
        <Crown className="w-3.5 h-3.5 text-amber-400" />
        Owner-only actions. Audit log preserved for 90 days.
      </div>
    </div>
  );
}

function humanise(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "AUTH_REQUIRED") return "Sign in to manage this extension.";
  if (msg === "FORBIDDEN") return "You don't own this extension.";
  if (msg === "CONFIRMATION_MISMATCH") return "Confirmation text didn't match.";
  return msg;
}
