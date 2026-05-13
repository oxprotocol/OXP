/**
 * `oxp setup` — detect every IDE on this machine and install the OXP host
 * adapter into each one automatically.
 *
 * VS Code-family IDEs (VS Code, Cursor, Windsurf, VSCodium, Insiders):
 *   Installs `oxprotocol.oxp-vscode` via `<cli> --install-extension`.
 *
 * JetBrains IDEs (IntelliJ, PyCharm, WebStorm, GoLand, Rider, …):
 *   Extracts the vendored plugin zip (bundled with the CLI) directly into
 *   the IDE's per-user plugins directory. The IDE picks it up on next start.
 *
 * Neovim:
 *   Prints a one-line plugin-manager snippet — we never write to nvim config.
 */

import { detectHosts } from "../lib/host-detect.js";
import {
  ensureAdapters,
  type AdapterStatus,
  NEOVIM_ADAPTER_REPO,
} from "../lib/host-adapter.js";

const HELP = `oxp setup [--yes] [--json]   Auto-install the OXP host adapter into every detected IDE

Flags:
  --yes, -y    Skip the confirmation prompt and install immediately.
  --json       Emit a machine-readable JSON result on a single line.
  --help, -h   Show this message.

Supported hosts:
  VS Code, Cursor, Windsurf, VSCodium, VS Code Insiders
    → installs oxprotocol.oxp-vscode via the IDE's CLI
  JetBrains IDEs (IntelliJ, PyCharm, WebStorm, GoLand, Rider, …)
    → extracts the bundled plugin zip into the IDE's plugins directory
  Neovim
    → prints a manual install snippet (plugin managers don't have a CLI API)
`;

export async function setup(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  const json = args.includes("--json");
  const yes = args.includes("--yes") || args.includes("-y");

  if (!json) {
    process.stdout.write("Detecting installed IDEs…\n\n");
  }

  const hosts = await detectHosts();
  const detected = hosts.filter((h) => h.installed || h.partial);

  if (detected.length === 0) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ ok: true, hosts: [], message: "no IDEs detected" }) +
          "\n",
      );
    } else {
      process.stdout.write(
        "  No IDEs detected on this machine.\n\n" +
          "  Install VS Code, Cursor, a JetBrains IDE, or Neovim, then re-run `oxp setup`.\n",
      );
    }
    return 0;
  }

  if (!json) {
    process.stdout.write(
      `  Found ${detected.length} IDE${detected.length === 1 ? "" : "s"}:\n`,
    );
    for (const h of detected) {
      const note = h.partial ? " (partial — CLI or data dir missing)" : "";
      process.stdout.write(`    • ${h.displayName}${note}\n`);
    }
    process.stdout.write("\n");

    if (!yes) {
      process.stdout.write(
        "  OXP will install the host adapter into each IDE listed above.\n" +
          "  Run `oxp setup --yes` to skip this prompt.\n\n" +
          "  Proceed? [Y/n] ",
      );
      const answer = await readLine();
      if (answer.trim().toLowerCase() === "n") {
        process.stdout.write("Cancelled.\n");
        return 0;
      }
      process.stdout.write("\n");
    }
  }

  const statuses = await ensureAdapters(detected);

  let manualNeovimSnippet: string | null = null;
  const results: Array<{
    id: string;
    displayName: string;
    status: string;
    reason?: string;
  }> = [];

  for (const s of statuses) {
    const row = {
      id: s.host.id,
      displayName: s.host.displayName,
      status: s.status,
      reason:
        s.status === "unavailable"
          ? s.reason
          : s.status === "failed"
            ? s.error
            : undefined,
    };
    results.push(row);

    if (s.status === "unavailable" && s.host.id === "neovim") {
      manualNeovimSnippet = NEOVIM_ADAPTER_REPO;
    }
  }

  if (json) {
    const ok = statuses.every(
      (s) => s.status === "present" || s.status === "installed",
    );
    process.stdout.write(JSON.stringify({ ok, hosts: results }) + "\n");
    return ok ? 0 : 1;
  }

  // Human-readable summary table.
  process.stdout.write("Results:\n\n");
  let allGood = true;
  for (const s of statuses) {
    const icon = statusIcon(s);
    const label = statusLabel(s);
    const name = s.host.displayName.padEnd(30);
    process.stdout.write(`  ${icon} ${name} ${label}\n`);
    if (s.status === "failed") allGood = false;
  }

  process.stdout.write("\n");

  if (manualNeovimSnippet) {
    process.stdout.write(
      "  Neovim — add to your plugin manager config:\n\n" +
        '    -- lazy.nvim\n    { "' +
        manualNeovimSnippet +
        '" }\n\n' +
        "    -- packer\n" +
        '    use "' +
        manualNeovimSnippet +
        '"\n\n',
    );
  }

  const ready = statuses.filter(
    (s) => s.status === "present" || s.status === "installed",
  ).length;
  const total = statuses.length;

  if (ready === total) {
    process.stdout.write(
      `  ✓ All ${total} host${total === 1 ? "" : "s"} ready.\n\n` +
        "  Install an extension: oxp install @publisher/slug\n",
    );
  } else {
    process.stdout.write(
      `  ${ready}/${total} hosts ready.\n\n` +
        "  Run `oxp doctor` to see the full setup report.\n",
    );
  }

  return allGood ? 0 : 1;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function statusIcon(s: AdapterStatus): string {
  switch (s.status) {
    case "present":
      return "✓";
    case "installed":
      return "✓";
    case "failed":
      return "✗";
    case "unsupported":
      return "–";
    case "unavailable":
      return "~";
  }
}

function statusLabel(s: AdapterStatus): string {
  switch (s.status) {
    case "present":
      return "OXP adapter already installed";
    case "installed":
      return "OXP adapter installed";
    case "failed":
      return `failed: ${s.error}`;
    case "unsupported":
      return "not supported";
    case "unavailable":
      return `manual setup required — ${s.reason}`;
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (chunk: unknown) => {
      buf += String(chunk);
      process.stdin.pause();
      resolve(buf.split("\n")[0] ?? "");
    });
  });
}
