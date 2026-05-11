#!/usr/bin/env node
// OXP v1 conformance runner — stub.
//
// Final form: builds tests/v1-conformance/extension via `oxp pack`,
// boots each requested host via its automation harness, replays every
// scenarios/*.json file, and emits JUnit XML per host.
//
// For now this script enumerates the scenarios so CI can confirm the
// suite is wired up. Real driver code lands per-host as adapters mature.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = join(here, "..", "scenarios");

const hostsArg = process.argv.find((a) => a.startsWith("--host="));
const hosts = hostsArg
  ? [hostsArg.slice("--host=".length)]
  : ["vscode", "jetbrains", "neovim", "piye"];

const files = (await readdir(scenariosDir)).filter((f) => f.endsWith(".json"));
let total = 0;
for (const f of files) {
  const data = JSON.parse(await readFile(join(scenariosDir, f), "utf8"));
  total += data.scenarios.length;
  console.log(
    `✓ loaded ${data.capability}: ${data.scenarios.length} scenarios`,
  );
}

console.log("");
console.log(`hosts under test: ${hosts.join(", ")}`);
console.log(`total scenarios:  ${total}`);
console.log("");
console.log("⚠ scenario driver not yet implemented — adapter harnesses TBD.");
console.log(
  "  This stub guarantees the spec stays in sync with scenario files.",
);
