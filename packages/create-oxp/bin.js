#!/usr/bin/env node
// `npm create oxp <project>` / `pnpm create oxp <project>` shim.
// Forwards to `@oxprotocol/cli create` via `npx --yes` so we always grab the
// latest published CLI without bundling it.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--yes", "@oxprotocol/cli@latest", "create", ...args],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("create-oxp: failed to invoke @oxprotocol/cli");
  console.error(err);
  process.exit(1);
});
