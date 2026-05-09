"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "oxp-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/**
 * Three-state theme toggle (light → dark → system → …).
 * Persists to localStorage and live-listens to OS theme when on "system".
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored =
      (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    setTheme(stored);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);

    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, mounted]);

  const cycle = () => {
    setTheme((t) =>
      t === "light" ? "dark" : t === "dark" ? "system" : "light",
    );
  };

  // Pre-mount: render an inert placeholder so SSR/CSR markup matches.
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Theme"
        className="inline-flex items-center justify-center w-9 h-9 rounded border border-[#7DD3FC]/15 text-[#f8fafc]/40"
      >
        <Monitor className="w-4 h-4" />
      </button>
    );
  }

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label =
    theme === "light"
      ? "Theme: Light (click for Dark)"
      : theme === "dark"
        ? "Theme: Dark (click for System)"
        : "Theme: System (click for Light)";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-9 h-9 rounded border border-[#7DD3FC]/15 text-[#f8fafc]/55 hover:text-[#7DD3FC] hover:border-[#7DD3FC]/40 hover:bg-[#7DD3FC]/5 transition-all"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

/**
 * Inline script that runs before React hydration to set the theme class
 * synchronously, preventing a flash of wrong theme. Mount in <head> via
 * `dangerouslySetInnerHTML`.
 */
export const themeBootstrapScript = `
(function() {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'system';
    var resolved = stored === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : stored;
    var root = document.documentElement;
    root.classList.toggle('light', resolved === 'light');
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  } catch (e) {}
})();
`.trim();
