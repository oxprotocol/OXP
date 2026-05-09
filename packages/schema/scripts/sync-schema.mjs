// Copies spec/v1/manifest.schema.json into packages/schema/src/ so the
// package is publishable as a self-contained npm artifact and so the JSON
// is resolvable via `import` without depending on the repo layout.
//
// Run via `pnpm --filter @oxprotocol/schema build` (it runs first), or directly.

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const src = resolve(repoRoot, "spec/v1/manifest.schema.json");
const dest = resolve(here, "../src/manifest.schema.json");

if (!existsSync(src)) {
  console.error(`[@oxprotocol/schema] source not found: ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`[@oxprotocol/schema] synced ${src} -> ${dest}`);
