// Build the OXP UI bundle.
//
// Why is this not just `esbuild --outdir=ui`?
// Because OXP's `ui-v1` policy forbids loose `.js` / `.css` files in the
// bundle for safety (CSP-style — only HTML may execute). So we build the
// React app and inline both the JS and the CSS into a single self-contained
// `ui/index.html`. That HTML is the only artefact that ships in the .oxp.
//
// Watch mode (`oxp dev`) re-runs this on every save.

import { context, build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const entry = "src/main.tsx";

const buildOptions = {
  entryPoints: [entry],
  bundle: true,
  minify: !watch,
  sourcemap: false, // inline maps would inflate the HTML; off in dev too
  target: "es2020",
  format: "iife", // executes immediately when injected via <script>
  loader: { ".css": "css" },
  legalComments: "none",
  write: false,
  outdir: "out",
  logLevel: "warning",
  plugins: [
    {
      name: "oxp-inline-html",
      setup(b) {
        b.onEnd(async (result) => {
          if (result.errors.length > 0) return;
          await emitInlinedHtml(result);
        });
      },
    },
  ],
};

async function emitInlinedHtml(result) {
  let js = "";
  let css = "";
  for (const f of result.outputFiles ?? []) {
    if (f.path.endsWith(".js")) js = f.text;
    else if (f.path.endsWith(".css")) css = f.text;
  }

  // Pull display name from oxp.json so the <title> stays in sync.
  let title = "OXP Extension";
  try {
    const m = JSON.parse(await readFile("oxp.json", "utf8"));
    if (typeof m.displayName === "string") title = m.displayName;
  } catch {
    /* fall back */
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

  await mkdir("ui", { recursive: true });
  await writeFile("ui/index.html", html);
  const kb = (html.length / 1024).toFixed(1);
  console.log(`✓ ui/index.html (${kb} KiB)`);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("watching src/ — Ctrl+C to stop");
} else {
  await build(buildOptions);
}
