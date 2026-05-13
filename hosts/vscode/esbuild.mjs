import { build, context } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

/**
 * Copy the compiled bridge IIFE into `dist/` so `loadBridgeScript()` can
 * find it at runtime without depending on a dev-only workspace layout.
 * The bridge is loaded as a string and injected into every extension
 * webview — without this step, production installs would silently fall
 * back to the "bridge not found" console.warn stub and every
 * `window.oxp.*` call would time out.
 */
function copyBridgeAsset() {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = resolve(here, "../../packages/sdk/dist/oxp-bridge.js");
  const out = resolve(here, "dist/oxp-bridge.js");
  if (!existsSync(src)) {
    console.warn(
      `⚠ oxp-bridge.js not found at ${src}; run \`pnpm -F @oxprotocol/sdk build\` first`,
    );
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(src, out);
  console.log(`✓ copied oxp-bridge.js → dist/`);
}

if (watch) {
  copyBridgeAsset();
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
  copyBridgeAsset();
}
