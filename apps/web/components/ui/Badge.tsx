import React from "react";
import { CheckCircle2, Clock, Sparkles } from "lucide-react";

export type BadgeVariant = "vsx" | "planned" | "native" | "default";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Shared status badge. All variants use min `text-xs` (12px) per style rules,
 * brand-cyan family only — no amber/gold/yellow.
 *
 * Variants:
 *  - `vsx`    — emerald, "VSX Compatible" — entry mirrored from Open VSX.
 *  - `planned`— sky outline, "OXP Native: Planned" — original author can claim.
 *  - `native` — cyan filled, "OXP Native" — first-class wasm-sandboxed build.
 *  - `default`— neutral cyan outline.
 */
export function Badge({
  variant = "default",
  children,
  icon,
  className = "",
}: BadgeProps) {
  const styles: Record<BadgeVariant, string> = {
    vsx: "border-emerald-400/30 bg-emerald-400/5 text-emerald-300",
    planned: "border-sky-400/30 bg-sky-400/5 text-sky-300",
    native: "border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#BAE6FD]",
    default: "border-[#7DD3FC]/15 bg-[#7DD3FC]/5 text-[#7DD3FC]/70",
  };
  const defaultIcon: Record<BadgeVariant, React.ReactNode> = {
    vsx: <CheckCircle2 className="w-3 h-3" />,
    planned: <Clock className="w-3 h-3" />,
    native: <Sparkles className="w-3 h-3" />,
    default: null,
  };
  const showIcon = icon ?? defaultIcon[variant];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono font-bold tracking-wider uppercase ${styles[variant]} ${className}`}
    >
      {showIcon}
      {children}
    </span>
  );
}

/**
 * Render the canonical badge set for a given tag list. Recognised tags:
 *   - `vsx-compatible`     → "VSX Compatible"
 *   - `oxp-native-planned` → "OXP Native: Planned"
 *   - `oxp-native`         → "OXP Native"
 */
export function StatusBadges({
  tags,
  className = "",
}: {
  tags: string[];
  className?: string;
}) {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  const out: React.ReactNode[] = [];
  if (set.has("vsx-compatible")) {
    out.push(
      <Badge key="vsx" variant="vsx">
        VSX Compatible
      </Badge>,
    );
  }
  if (set.has("oxp-native-planned")) {
    out.push(
      <Badge key="planned" variant="planned">
        OXP Native: Planned
      </Badge>,
    );
  }
  if (set.has("oxp-native")) {
    out.push(
      <Badge key="native" variant="native">
        OXP Native
      </Badge>,
    );
  }
  if (out.length === 0) return null;
  return <div className={`flex flex-wrap gap-1.5 ${className}`}>{out}</div>;
}
