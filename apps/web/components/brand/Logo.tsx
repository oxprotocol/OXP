"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

interface LogoProps {
  /** Visual size of the wordmark. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Show the "Open eXtensions Protocol" subtitle line. */
  showSubtitle?: boolean;
  /** Disable the typewriter animation; cursor still blinks. */
  staticText?: boolean;
  /** Use a calm, infrequent cursor blink (subtle on non-landing pages). */
  calmCursor?: boolean;
  /** Optional className passed to the outer wrapper. */
  className?: string;
}

const TERMINAL_ACCENT = "var(--primary)"; // theme-reactive (cyan dark / sky-600 light)
const FOREGROUND = "var(--foreground)";
const FULL_TEXT = "oxp.sh";

/**
 * OXP logo — terminal prompt.
 *
 *   > oxp.sh▌
 *
 * - When animated, the wordmark types itself (with a layout-locked slot so
 *   surrounding nav items never shift).
 * - When `staticText`, the full string is shown immediately and only the
 *   cursor blinks — used in the footer.
 */
export function Logo({
  size = "md",
  showSubtitle = false,
  staticText = false,
  calmCursor = false,
  className,
}: LogoProps) {
  const dims = SIZE_MAP[size];
  const typed = useTypewriter(FULL_TEXT, !staticText);

  const dotIdx = typed.indexOf(".");
  const head = dotIdx === -1 ? typed : typed.slice(0, dotIdx);
  const tail = dotIdx === -1 ? "" : typed.slice(dotIdx);

  const fontStack =
    "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

  return (
    <span
      className={cn(
        "inline-flex flex-col leading-none",
        showSubtitle ? "items-start" : "items-center",
        className,
      )}
    >
      <span
        className="inline-flex items-center font-mono"
        style={{
          fontFamily: fontStack,
          fontSize: dims.fontSize,
          letterSpacing: "-0.01em",
          lineHeight: 1,
        }}
        aria-label={FULL_TEXT}
      >
        <span
          aria-hidden
          style={{
            color: TERMINAL_ACCENT,
            marginRight: dims.gap,
            fontWeight: 700,
          }}
        >
          &gt;
        </span>

        {/* Locked-width slot: ghost copy reserves final width so siblings never shift. */}
        <span
          style={{
            display: "inline-grid",
            gridTemplateAreas: '"stack"',
            alignItems: "center",
          }}
        >
          <span
            aria-hidden
            style={{
              gridArea: "stack",
              visibility: "hidden",
              whiteSpace: "pre",
              fontWeight: 700,
            }}
          >
            {FULL_TEXT}
            <span
              style={{
                display: "inline-block",
                width: dims.cursorW,
                marginLeft: 2,
              }}
            />
          </span>

          <span
            style={{
              gridArea: "stack",
              whiteSpace: "pre",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <span style={{ color: FOREGROUND, fontWeight: 700 }}>{head}</span>
            <span style={{ color: FOREGROUND, opacity: 0.55, fontWeight: 600 }}>
              {tail}
            </span>
            <span
              aria-hidden
              className={
                calmCursor
                  ? "animate-terminal-blink-slow"
                  : "animate-terminal-blink"
              }
              style={{
                display: "inline-block",
                width: dims.cursorW,
                height: dims.cursorH,
                background: TERMINAL_ACCENT,
                marginLeft: 2,
                transform: `translateY(${dims.cursorOffset}px)`,
                boxShadow: `0 0 10px var(--primary)`,
              }}
            />
          </span>
        </span>
      </span>

      {showSubtitle && (
        <span
          className="mt-3 font-mono text-xs tracking-[0.04em]"
          style={{ color: FOREGROUND, opacity: 0.6 }}
        >
          <AccentLetter>O</AccentLetter>pen e<AccentLetter>X</AccentLetter>
          tensions <AccentLetter>P</AccentLetter>rotocol
        </span>
      )}
    </span>
  );
}

/** Just bold + accent color for the O / X / P drop-caps. Same size, no enlargement. */
function AccentLetter({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: TERMINAL_ACCENT, fontWeight: 700 }}>{children}</span>
  );
}

/** Just the prompt + cursor — used in tight spaces and as the favicon source. */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="OXP shell"
      className={className}
    >
      <path
        d="M5 8 L13 16 L5 24"
        stroke={TERMINAL_ACCENT}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={17}
        y={10}
        width={10}
        height={12}
        rx={1}
        fill={TERMINAL_ACCENT}
      />
    </svg>
  );
}

// ─── Typewriter hook ─────────────────────────────────────────────────────────

function useTypewriter(full: string, enabled: boolean): string {
  const [text, setText] = useState(enabled ? "" : full);

  useEffect(() => {
    if (!enabled) {
      setText(full);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const TYPE_MS = 70;
    const TYPE_JITTER = 15;
    const ERASE_MS = 40;
    const HOLD_FULL_MS = 1800;
    const HOLD_EMPTY_MS = 600;

    const schedule = (fn: () => void, ms: number) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const typeChar = (i: number) => {
      if (i > full.length) {
        schedule(() => eraseChar(full.length), HOLD_FULL_MS);
        return;
      }
      setText(full.slice(0, i));
      const jitter = (Math.random() * 2 - 1) * TYPE_JITTER;
      schedule(() => typeChar(i + 1), TYPE_MS + jitter);
    };

    const eraseChar = (i: number) => {
      if (i < 0) {
        schedule(() => typeChar(0), HOLD_EMPTY_MS);
        return;
      }
      setText(full.slice(0, i));
      schedule(() => eraseChar(i - 1), ERASE_MS);
    };

    typeChar(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [full, enabled]);

  return text;
}

// ─── Sizing — bumped one step up across the board ───────────────────────────

const SIZE_MAP: Record<
  NonNullable<LogoProps["size"]>,
  {
    fontSize: number;
    gap: number;
    cursorW: number;
    cursorH: number;
    cursorOffset: number;
  }
> = {
  sm: { fontSize: 22, gap: 7, cursorW: 10, cursorH: 20, cursorOffset: 3 },
  md: { fontSize: 28, gap: 9, cursorW: 12, cursorH: 26, cursorOffset: 3 },
  lg: { fontSize: 38, gap: 12, cursorW: 16, cursorH: 34, cursorOffset: 4 },
  xl: { fontSize: 56, gap: 16, cursorW: 22, cursorH: 50, cursorOffset: 6 },
};
