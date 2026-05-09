import { BadgeCheck, ShieldCheck } from "lucide-react";

type Level = "unverified" | "github" | "domain" | null | undefined;

const LIGHT_RING_DOMAIN = "ring-emerald-400/30 light:ring-emerald-500/40";
const LIGHT_RING_GITHUB = "ring-sky-400/30 light:ring-sky-500/40";

/**
 * Phase B.8 — Verified-publisher trust marker.
 *
 *   domain → emerald `BadgeCheck` ("Verified via DNS")
 *   github → sky `ShieldCheck` ("Verified via GitHub")
 *   unverified → null (renders nothing)
 *
 * Designed to sit inline next to a handle. Use `size="sm"` for cards and
 * `size="md"` for detail headers. The `tooltip` is rendered via native
 * `title` so it works inside server components without JS.
 */
export function VerifiedBadge({
  level,
  domain,
  githubLogin,
  size = "sm",
  className = "",
}: {
  level: Level;
  domain?: string | null;
  githubLogin?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!level || level === "unverified") return null;

  const isDomain = level === "domain";
  const Icon = isDomain ? BadgeCheck : ShieldCheck;

  const dim = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
  const pad = size === "md" ? "px-1.5 py-0.5" : "px-1.5 py-[1px]";

  const tone = isDomain
    ? `text-emerald-300 light:text-emerald-700 bg-emerald-400/10 light:bg-emerald-50 ring-1 ${LIGHT_RING_DOMAIN}`
    : `text-sky-300 light:text-sky-700 bg-sky-400/10 light:bg-sky-50 ring-1 ${LIGHT_RING_GITHUB}`;

  const tooltip = isDomain
    ? domain
      ? `Verified — DNS proof on ${domain}`
      : "Verified — DNS proof on claimed domain"
    : githubLogin
      ? `Verified — GitHub OAuth as @${githubLogin}`
      : "Verified — GitHub OAuth";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded ${pad} ${tone} text-xs font-mono align-middle ${className}`}
      title={tooltip}
      aria-label={tooltip}
    >
      <Icon className={dim} aria-hidden />
      <span className="leading-none">{isDomain ? "verified" : "github"}</span>
    </span>
  );
}

/** Compact icon-only variant for tight rows (e.g. listings). */
export function VerifiedDot({
  level,
  domain,
  githubLogin,
  className = "",
}: {
  level: Level;
  domain?: string | null;
  githubLogin?: string | null;
  className?: string;
}) {
  if (!level || level === "unverified") return null;
  const isDomain = level === "domain";
  const Icon = isDomain ? BadgeCheck : ShieldCheck;
  const tone = isDomain
    ? "text-emerald-400 light:text-emerald-600"
    : "text-sky-400 light:text-sky-600";
  const tooltip = isDomain
    ? domain
      ? `Verified — DNS proof on ${domain}`
      : "Verified — DNS proof"
    : githubLogin
      ? `Verified — GitHub @${githubLogin}`
      : "Verified — GitHub";
  return (
    <Icon className={`w-3.5 h-3.5 ${tone} ${className}`} aria-label={tooltip}>
      <title>{tooltip}</title>
    </Icon>
  );
}
