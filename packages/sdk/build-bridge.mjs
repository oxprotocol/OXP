import { build } from "esbuild";

await build({
  entryPoints: ["src/bridge.ts"],
  bundle: true,
  format: "iife",
  globalName: "__oxp_bridge_init",
  outfile: "dist/oxp-bridge.js",
  minify: true,
  sourcemap: false,
  target: "es2020",
  platform: "browser",
});

console.log("✓ dist/oxp-bridge.js built");
