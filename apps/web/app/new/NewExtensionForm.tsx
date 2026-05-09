"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2, Lock, Sparkles } from "lucide-react";
import { createExtension } from "./actions";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function NewExtensionForm({ ownerHandle }: { ownerHandle: string }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const submit = () => {
    setError(null);
    if (!name.trim() || !effectiveSlug) {
      setError("Name and slug are required.");
      return;
    }
    start(async () => {
      try {
        await createExtension({
          name: name.trim(),
          slug: effectiveSlug,
          description: description.trim(),
          visibility,
        });
      } catch (e) {
        // redirect() throws NEXT_REDIRECT — surface only real errors
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="hud-card hud-corners p-8 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="w-4 h-4 text-[#7DD3FC]/60" />
          <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase">
            {"// Create Extension"}
          </h2>
        </div>

        {error && (
          <div className="text-xs font-mono text-red-300 border border-red-500/30 bg-red-500/5 rounded px-3 py-2">
            {error}
          </div>
        )}

        <Field label="Name" hint="Human-readable. Shown on the registry card.">
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="My Awesome Extension"
            className="w-full bg-[#030711] rounded border border-[#7DD3FC]/15 px-3 py-2 text-sm font-mono text-[#f8fafc] focus:outline-none focus:border-[#7DD3FC]/40 placeholder-[#f8fafc]/20"
          />
        </Field>

        <Field
          label="Slug"
          hint={`Install id will be @${ownerHandle}/${effectiveSlug || "your-slug"}`}
        >
          <div className="flex items-center bg-[#030711] rounded border border-[#7DD3FC]/15 px-3 py-2 text-sm font-mono text-[#f8fafc]/40">
            <span>@{ownerHandle}/</span>
            <input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="your-slug"
              className="bg-transparent text-[#f8fafc] focus:outline-none flex-1 min-w-0"
            />
          </div>
        </Field>

        <Field label="Description" hint="One sentence. You can edit later.">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this extension do?"
            rows={3}
            className="w-full bg-[#030711] rounded border border-[#7DD3FC]/15 px-3 py-2 text-sm font-mono text-[#f8fafc] focus:outline-none focus:border-[#7DD3FC]/40 placeholder-[#f8fafc]/20 resize-none"
          />
        </Field>

        <Field label="Visibility" hint="">
          <div className="grid grid-cols-2 gap-3">
            <VisibilityCard
              active={visibility === "public"}
              onClick={() => setVisibility("public")}
              icon={<Eye className="w-4 h-4" />}
              title="Public"
              body="Listed in the registry. Free."
            />
            <VisibilityCard
              active={visibility === "private"}
              onClick={() => setVisibility("private")}
              icon={<EyeOff className="w-4 h-4" />}
              title="Private"
              body="Only you and collaborators. Pro."
              proLocked
            />
          </div>
        </Field>

        <div className="flex items-center justify-between gap-4 pt-2">
          <p className="text-[10px] font-mono text-[#f8fafc]/30">
            Owner: <span className="text-[#7DD3FC]/60">@{ownerHandle}</span>
          </p>
          <button
            onClick={submit}
            disabled={pending || !name.trim() || !effectiveSlug}
            className="inline-flex items-center gap-2 px-5 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase bg-[#7DD3FC] text-[#060a13] hover:bg-[#BAE6FD] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {pending && <Loader2 className="w-3 h-3 animate-spin" />}
            Create Extension
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[10px] font-mono text-[#f8fafc]/30">{hint}</p>
      )}
    </div>
  );
}

function VisibilityCard({
  active,
  onClick,
  icon,
  title,
  body,
  proLocked,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
  proLocked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded border transition-all relative ${
        active
          ? "border-[#7DD3FC]/50 bg-[#7DD3FC]/5"
          : "border-[#7DD3FC]/10 hover:border-[#7DD3FC]/30 bg-transparent"
      }`}
    >
      <div className="flex items-center gap-2 mb-2 text-[#7DD3FC]/80">
        {icon}
        <span className="text-xs font-mono font-bold uppercase tracking-wider">
          {title}
        </span>
        {proLocked && (
          <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border border-amber-300/40 text-amber-200/80 bg-amber-300/10">
            <Lock className="w-2.5 h-2.5" /> Pro
          </span>
        )}
      </div>
      <p className="text-[11px] font-mono text-[#f8fafc]/40 leading-relaxed">
        {body}
      </p>
    </button>
  );
}
