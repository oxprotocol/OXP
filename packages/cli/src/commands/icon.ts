/**
 * `oxp icon` — author-side helpers for generating extension icons.
 *
 * Subcommands:
 *   oxp icon init [-t TEMPLATE] [--out icon.svg]
 *       Drop a starter `icon.svg` and matching `icon.png` into the
 *       current dir. Templates: chevron (default), terminal, branch,
 *       swatch, package, monogram.
 *
 *   oxp icon from <emoji-or-text> [--bg #HEX] [--fg #HEX] [--out icon.svg]
 *       Generate an icon from an emoji ("🚀") or a 1–3 character
 *       monogram ("AB"). Writes both `icon.svg` and `icon.png`.
 *
 *   oxp icon convert <input.svg> [--out icon.png] [--size 256]
 *       Rasterise an existing SVG into a PNG (default 256×256). The
 *       SVG is the source of truth; the PNG is what most IDE hosts
 *       render natively.
 *
 * Why both files?
 *   - JetBrains plugins can't ship the IntelliJ SVG decoder
 *     (`com.intellij.util.SVGLoader` is `@ApiStatus.Internal`), so
 *     PNG is the cross-host floor.
 *   - VS Code, the marketplace web UI, and `oxp pack` all happily
 *     accept SVG.
 *   - Authors should reference the PNG in `manifest.icon` for maximum
 *     compatibility, but keep the SVG in their repo for editing and
 *     re-export at higher densities.
 *
 * Resvg (the WASM/native renderer behind `convert`) is licensed under
 * MPL-2.0 + Apache-2.0; it's a leaf dep, no GPL contamination.
 */

import { promises as fs } from "node:fs";
import { resolve, dirname } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { fail, info } from "../util.js";

interface Template {
  description: string;
  /** SVG body assuming a 256×256 viewBox; bg is filled separately. */
  svg: (opts: { fg: string; bg: string }) => string;
}

/**
 * Built-in starter templates. All are 256×256 with a rounded-square
 * background so they look at home in IDE chrome (which is the only
 * place these icons ever render).
 */
const TEMPLATES: Record<string, Template> = {
  chevron: {
    description: "Chevron + block — the default OXP look",
    svg: ({ fg }) => `
      <path d="M70 60 L40 90 L116 160 L40 230 L70 260 L150 188 L150 132 Z"
            fill="${fg}" transform="scale(0.7) translate(60 0)"/>
      <rect x="160" y="80" width="64" height="96" rx="12" fill="${fg}"/>
    `,
  },
  terminal: {
    description: "Terminal window with a prompt",
    svg: ({ fg }) => `
      <rect x="48" y="64" width="160" height="128" rx="14"
            fill="none" stroke="${fg}" stroke-width="12"/>
      <path d="M76 108 L100 128 L76 148" fill="none" stroke="${fg}"
            stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="116" y1="156" x2="172" y2="156"
            stroke="${fg}" stroke-width="12" stroke-linecap="round"/>
    `,
  },
  branch: {
    description: "Git branch graph",
    svg: ({ fg }) => `
      <circle cx="80" cy="64" r="18" fill="${fg}"/>
      <circle cx="80" cy="192" r="18" fill="${fg}"/>
      <circle cx="176" cy="128" r="18" fill="${fg}"/>
      <line x1="80" y1="82" x2="80" y2="174"
            stroke="${fg}" stroke-width="12"/>
      <path d="M80 128 Q 80 128 176 128"
            fill="none" stroke="${fg}" stroke-width="12"/>
    `,
  },
  swatch: {
    description: "2×2 colour swatch grid",
    svg: ({ fg }) => `
      <rect x="56"  y="56"  width="64" height="64" rx="8" fill="${fg}" opacity="0.95"/>
      <rect x="136" y="56"  width="64" height="64" rx="8" fill="${fg}" opacity="0.70"/>
      <rect x="56"  y="136" width="64" height="64" rx="8" fill="${fg}" opacity="0.50"/>
      <rect x="136" y="136" width="64" height="64" rx="8" fill="${fg}" opacity="0.30"/>
    `,
  },
  package: {
    description: "Closed shipping box",
    svg: ({ fg }) => `
      <path d="M128 36 L224 88 L224 184 L128 236 L32 184 L32 88 Z"
            fill="none" stroke="${fg}" stroke-width="12"
            stroke-linejoin="round"/>
      <path d="M32 88 L128 140 L224 88" fill="none"
            stroke="${fg}" stroke-width="12" stroke-linejoin="round"/>
      <line x1="128" y1="140" x2="128" y2="236"
            stroke="${fg}" stroke-width="12"/>
    `,
  },
};

const TEMPLATE_NAMES = Object.keys(TEMPLATES);

const HELP = `oxp icon — generate an extension icon (SVG + PNG)

Usage:
  oxp icon init     [-t TEMPLATE] [--bg #HEX] [--fg #HEX] [--out icon.svg]
  oxp icon from     <emoji|TEXT>  [--bg #HEX] [--fg #HEX] [--out icon.svg]
  oxp icon convert  <input.svg>   [--out icon.png] [--size 256]
  oxp icon preview  [icon.svg|icon.png]   [--no-open]
  oxp icon help

Templates: ${TEMPLATE_NAMES.join(", ")}

Tips:
  - Reference the PNG in oxp.json:  "icon": "icon.png"
  - Keep the SVG in your repo so you can re-export at higher density.
  - Free icon catalogues you can use as inspiration (all MIT/CC):
      Lucide       https://lucide.dev
      Tabler       https://tabler.io/icons
      Phosphor     https://phosphoricons.com
  - In-browser editor:  https://icon.kitchen
`;

export async function icon(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return 0;
    case "init":
      return iconInit(rest);
    case "from":
      return iconFrom(rest);
    case "convert":
      return iconConvert(rest);
    case "preview":
      return iconPreview(rest);
    default:
      process.stderr.write(`oxp icon: unknown subcommand '${sub}'\n\n${HELP}`);
      return 2;
  }
}

async function iconInit(args: string[]): Promise<number> {
  const opts = parseFlags(args);
  const tplName = (opts.flags.t ?? opts.flags.template ?? "chevron").toString();
  const tpl = TEMPLATES[tplName];
  if (!tpl) {
    fail(
      `unknown template '${tplName}'. Available: ${TEMPLATE_NAMES.join(", ")}`,
    );
  }
  const fg = normaliseHex(opts.flags.fg ?? "#ffffff", "fg");
  const bg = normaliseHex(opts.flags.bg ?? "#0d6efd", "bg");
  const outSvg = resolve(String(opts.flags.out ?? "icon.svg"));
  const svg = wrapSvg(tpl.svg({ fg, bg }), bg);
  await writeIconPair(outSvg, svg);
  info(`✓ wrote ${tplName} template`);
  return 0;
}

async function iconFrom(args: string[]): Promise<number> {
  const opts = parseFlags(args);
  const text = opts.positional[0];
  if (!text)
    fail("usage: oxp icon from <emoji-or-text> [--bg #HEX] [--fg #HEX]");
  const fg = normaliseHex(opts.flags.fg ?? "#ffffff", "fg");
  const bg = normaliseHex(opts.flags.bg ?? "#0d6efd", "bg");
  const outSvg = resolve(String(opts.flags.out ?? "icon.svg"));
  const cluster = [...new Intl.Segmenter().segment(text)];
  const isEmoji =
    cluster.length === 1 && /\p{Extended_Pictographic}/u.test(text);
  if (isEmoji) {
    // resvg has no access to system color-emoji fonts, so the PNG
    // would be a blank rounded square. Rather than ship something
    // broken, render via the Twemoji CDN (Twitter's open-source
    // emoji set, MIT/CC-BY-4.0). The SVG is downloaded once and
    // composited onto the chosen background.
    return iconFromEmoji(text, { fg, bg, outSvg });
  }
  const display = text.slice(0, 3).toUpperCase();
  const fontSize =
    display.length === 1 ? 170 : display.length === 2 ? 130 : 100;
  const body = `
    <text x="128" y="128" text-anchor="middle" dominant-baseline="central"
          font-family="system-ui,-apple-system,'Segoe UI',sans-serif"
          font-weight="700" font-size="${fontSize}" fill="${fg}">${escapeXml(display)}</text>
  `;
  const svg = wrapSvg(body, bg);
  await writeIconPair(outSvg, svg);
  info(`✓ wrote monogram icon for "${display}"`);
  return 0;
}

/**
 * Render an emoji icon by fetching the Twemoji SVG for the given
 * codepoint(s) and embedding it inside our standard rounded-square
 * frame. We pin to a specific Twemoji release so the output is
 * reproducible and we can host the same CDN URL during dev.
 */
async function iconFromEmoji(
  text: string,
  opts: { fg: string; bg: string; outSvg: string },
): Promise<number> {
  // Twemoji filenames are dash-separated lowercase hex codepoints,
  // with the variation selector U+FE0F dropped.
  const cp = [...text]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((h) => h !== "fe0f")
    .join("-");
  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cp}.svg`;
  info(`  fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    fail(
      `Twemoji has no SVG for "${text}" (${url} → ${res.status}). ` +
        `Try a single-codepoint emoji, or use 'oxp icon from <text>' for a monogram.`,
    );
  }
  const inner = await res.text();
  // Strip any outer <svg> wrapper and re-embed at our 256×256 scale.
  const match = inner.match(
    /<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/i,
  );
  const inside = match ? match[2] : inner;
  const viewBox = match ? match[1] : "0 0 36 36";
  const body = `
    <svg x="32" y="32" width="192" height="192" viewBox="${viewBox}">
      ${inside}
    </svg>
  `;
  const svg = wrapSvg(body, opts.bg);
  await writeIconPair(opts.outSvg, svg);
  info(`✓ wrote emoji icon for "${text}"`);
  return 0;
}

async function iconConvert(args: string[]): Promise<number> {
  const opts = parseFlags(args);
  const input = opts.positional[0];
  if (!input)
    fail("usage: oxp icon convert <input.svg> [--out icon.png] [--size 256]");
  const inputPath = resolve(input);
  const outPath = resolve(String(opts.flags.out ?? deriveOut(inputPath)));
  const size = Number(opts.flags.size ?? 256);
  if (!Number.isFinite(size) || size < 16 || size > 2048) {
    fail(`--size must be between 16 and 2048 (got ${opts.flags.size})`);
  }
  const svg = await fs.readFile(inputPath, "utf8");
  const png = renderSvgToPng(svg, size);
  await fs.mkdir(dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, png);
  info(`✓ ${inputPath} → ${outPath} (${size}×${size})`);
  return 0;
}

/**
 * Render a tiny HTML preview that shows the icon at the sizes IDE
 * hosts actually use — 16 (activity bar), 24 (tabs), 48 (lists), 128
 * (marketplace tile), 256 (detail header). Opens it in the default
 * browser unless `--no-open` is passed.
 *
 * This is the "see what your icon looks like before you ship it" step
 * authors otherwise have to do manually. Defaults to looking for
 * `icon.svg`, then `icon.png`, in the current dir.
 */
async function iconPreview(args: string[]): Promise<number> {
  const opts = parseFlags(args);
  const inputArg = opts.positional[0];
  const candidates = inputArg ? [inputArg] : ["icon.svg", "icon.png"];
  let resolvedPath: string | undefined;
  for (const c of candidates) {
    const p = resolve(c);
    try {
      await fs.access(p);
      resolvedPath = p;
      break;
    } catch {
      /* keep looking */
    }
  }
  if (!resolvedPath) {
    fail(
      `no icon found. Pass a path (oxp icon preview path/to/icon.svg) or run from a dir containing icon.svg / icon.png`,
    );
  }

  const isSvg = /\.svg$/i.test(resolvedPath);
  const bytes = await fs.readFile(resolvedPath);
  const dataUrl = isSvg
    ? `data:image/svg+xml;base64,${bytes.toString("base64")}`
    : `data:image/png;base64,${bytes.toString("base64")}`;

  const sizes = [16, 24, 48, 128, 256];
  const tiles = sizes
    .map(
      (s) => `
      <figure>
        <div class="tile" style="width:${s}px;height:${s}px">
          <img src="${dataUrl}" width="${s}" height="${s}" alt="${s}px"/>
        </div>
        <figcaption>${s}×${s}<br/><small>${labelFor(s)}</small></figcaption>
      </figure>`,
    )
    .join("");

  const html = `<!doctype html>
<meta charset="utf-8"/>
<title>OXP icon preview — ${resolvedPath.split("/").pop()}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif;
         margin: 0; padding: 32px;
         background: #f5f5f7; color: #111; }
  @media (prefers-color-scheme: dark) {
    body { background: #1e1e1e; color: #eee; }
    .tile { background: #2a2a2a; }
    .swatch.dark { outline: 2px solid #555; }
  }
  h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  .path { color: #888; font-family: ui-monospace, monospace;
          font-size: 12px; margin-bottom: 24px; }
  .row { display: flex; gap: 32px; align-items: flex-end;
         flex-wrap: wrap; margin-bottom: 32px; }
  figure { margin: 0; text-align: center; }
  figcaption { margin-top: 8px; color: #666; font-size: 12px; }
  .tile { display: flex; align-items: center; justify-content: center;
          background: #fff; border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .swatches { display: flex; gap: 16px; margin-top: 16px; }
  .swatch { padding: 16px; border-radius: 8px;
            display: flex; align-items: center; gap: 12px;
            font-size: 12px; }
  .swatch.light { background: #fff; color: #111; }
  .swatch.dark  { background: #1e1e1e; color: #eee; }
  .swatch img { width: 24px; height: 24px; }
</style>
<h1>${resolvedPath.split("/").pop()}</h1>
<div class="path">${resolvedPath}</div>

<h2>Render sizes</h2>
<div class="row">${tiles}</div>

<h2>Theme contrast (24×24)</h2>
<div class="swatches">
  <div class="swatch light"><img src="${dataUrl}"/>Light background</div>
  <div class="swatch dark"><img src="${dataUrl}"/>Dark background</div>
</div>

<h2>Marketplace tile (128×128, OXP-style)</h2>
<div class="row">
  <div class="tile" style="width:160px;height:160px">
    <img src="${dataUrl}" width="128" height="128"/>
  </div>
</div>
`;

  const outPath = resolve(".oxp-icon-preview.html");
  await fs.writeFile(outPath, html);
  info(`✓ wrote ${outPath}`);

  if (!("no-open" in opts.flags)) {
    const open =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    const { spawn } = await import("node:child_process");
    spawn(open, [outPath], { detached: true, stdio: "ignore" }).unref();
    info(`→ opened in your browser`);
  } else {
    info(`→ open ${outPath} in your browser`);
  }
  return 0;
}

function labelFor(size: number): string {
  switch (size) {
    case 16:
      return "activity bar";
    case 24:
      return "tabs";
    case 48:
      return "list rows";
    case 128:
      return "marketplace";
    case 256:
      return "detail";
    default:
      return "";
  }
}

/* -------------------------------------------------------------------- */
/* Helpers                                                              */
/* -------------------------------------------------------------------- */

/** Wrap a body fragment in a 256×256 SVG with a rounded background. */
function wrapSvg(body: string, bg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="${bg}"/>
  ${body.trim()}
</svg>
`;
}

/**
 * Write the SVG and a rasterised 256×256 PNG sibling. We always emit
 * both because most authors will want the PNG referenced from the
 * manifest (cross-host floor) and the SVG kept for editing.
 */
async function writeIconPair(svgPath: string, svg: string): Promise<void> {
  const pngPath = svgPath.replace(/\.svg$/i, ".png");
  await fs.mkdir(dirname(svgPath), { recursive: true });
  await fs.writeFile(svgPath, svg);
  const png = renderSvgToPng(svg, 256);
  await fs.writeFile(pngPath, png);
  info(`  ${svgPath}`);
  info(`  ${pngPath}`);
  info(`  → set "icon": "${pngPath.split("/").pop()}" in oxp.json`);
}

/** Native SVG → PNG via resvg-js. Exported for `oxp pack` auto-rasterise. */
export function renderSvgToPng(svg: string, size: number): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0,0,0,0)",
  });
  return Buffer.from(r.render().asPng());
}

function deriveOut(inputPath: string): string {
  return inputPath.replace(/\.svg$/i, ".png");
}

function normaliseHex(value: unknown, label: string): string {
  const raw = String(value).trim();
  const v = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v)) {
    fail(`--${label} must be a hex colour like #0d6efd (got '${raw}')`);
  }
  return v.toLowerCase();
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

/**
 * Tiny flag parser: `--key value`, `--key=value`, and `-k value`. Bare
 * positional arguments end up in `positional`. We don't need anything
 * more sophisticated for this command.
 */
function parseFlags(args: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        flags[a.slice(2)] = String(args[++i] ?? "");
      }
    } else if (a.startsWith("-") && a.length === 2) {
      flags[a.slice(1)] = String(args[++i] ?? "");
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}
