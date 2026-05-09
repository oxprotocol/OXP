/**
 * Universal user/org avatar.
 *
 * Renders the uploaded image when `url` is present, otherwise falls back
 * to the initials chip used everywhere in the OXP UI. The chip styling
 * matches the existing terminal-HUD aesthetic so this is a drop-in for
 * legacy `<div className="...">{seed}</div>` blocks.
 */

import * as React from "react";

export interface AvatarProps {
  /** Uploaded avatar URL (relative `/api/avatars/<id>` or absolute). */
  url?: string | null;
  /** Cache-busting suffix — typically `user.avatarUpdatedAt`. */
  version?: string | number | null;
  /** 1–2 character initials fallback. */
  seed: string;
  /** Tailwind size class on a square chip. Default `w-10 h-10`. */
  size?: string;
  /** Override font size for the initials. */
  textSize?: string;
  /** Render as a perfect circle (default keeps the squared HUD look). */
  rounded?: "square" | "full";
  alt?: string;
  className?: string;
}

export function Avatar({
  url,
  version,
  seed,
  size = "w-10 h-10",
  textSize = "text-sm",
  rounded = "square",
  alt,
  className = "",
}: AvatarProps) {
  const radius = rounded === "full" ? "rounded-full" : "rounded";
  const base =
    `${size} ${radius} flex items-center justify-center border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 text-[#7DD3FC] font-mono font-bold overflow-hidden ${className}`.trim();

  if (url) {
    const src = version
      ? `${url}?v=${encodeURIComponent(String(version))}`
      : url;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? seed}
        className={`${base} object-cover`}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <div className={`${base} ${textSize}`} aria-label={alt ?? seed}>
      {seed}
    </div>
  );
}
