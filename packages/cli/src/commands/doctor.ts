/**
 * `oxp doctor` — print a health summary so users (and support tickets) can
 * answer "what does my setup look like?" in one command.
 *
 * Reports:
 *   - CLI version & node version
 *   - Registry URL & login state (handle, scopes, expiry)
 *   - OXP_HOME location, runtime binary, store layout
 *   - Detected IDEs and host-adapter status (read-only — never installs)
 *
 * Always exits 0 on a successful report; non-zero only when the doctor
 * itself crashes. Issues are presented in the report, not via exit code,
 * so pipelines can still capture the JSON output.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir, platform, release } from "node:os";

import { detectHosts } from "../lib/host-detect.js";
import { ensureAdapters } from "../lib/host-adapter.js";
import { info, oxpHome, readCredentials, registryUrl } from "../util.js";

interface WhoamiResp {
  ok?: boolean;
  handle?: string | null;
  email?: string;
  token?: { scopes?: string[]; expiresAt?: string | null };
}

const HELP = `oxp doctor [--json]   Inspect this machine and report what OXP can see

Flags:
  --json   Emit a machine-readable JSON report on a single line.
`;

export async function doctor(args: string[]): Promise<number> {
  if (args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const json = args.includes("--json");

  const home = oxpHome();
  const reg = registryUrl();
  const tokenPresent = !!(await readCredentials());

  // Best-effort whoami (registry might be down — fall through silently).
  let who: WhoamiResp | null = null;
  if (tokenPresent) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3_000);
      const tok = await readCredentials();
      const r = await fetch(`${reg}/api/v1/auth/whoami`, {
        headers: { authorization: `Bearer ${tok ?? ""}` },
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      if (r.ok) who = (await r.json()) as WhoamiResp;
    } catch {
      // network/DNS error — leave who as null
    }
  }

  // Filesystem layout — every path is reported with present:true|false so
  // the user knows what's there and what isn't.
  const paths = await reportPaths(home);

  // Detect IDEs (skip running-process probe to keep the doctor cheap).
  const detected = await detectHosts({ skipProcessProbe: false });
  const adapters = await ensureAdapters(detected, { reportOnly: true });

  if (json) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        cli: {
          version: "0.1.0",
          node: process.version,
          platform: platform(),
          release: release(),
        },
        registry: {
          url: reg,
          loggedIn: tokenPresent,
          handle: who?.handle ?? null,
          scopes: who?.token?.scopes ?? [],
          expiresAt: who?.token?.expiresAt ?? null,
        },
        oxpHome: home,
        paths,
        hosts: adapters.map((a) => ({
          id: a.host.id,
          name: a.host.displayName,
          family: a.host.family,
          installed: a.host.installed,
          running: a.host.running,
          cliPath: a.host.cliPath ?? null,
          userDataDir: a.host.userDataDir ?? null,
          extensionsDir: a.host.extensionsDir ?? null,
          adapter: a.status,
          adapterReason:
            a.status === "unavailable"
              ? a.reason
              : a.status === "failed"
                ? a.error
                : undefined,
        })),
      }) + "\n",
    );
    return 0;
  }

  info(`OXP doctor`);
  info(`──────────────────────────────────────────────────────────`);
  info(
    `CLI:        v0.1.0  ·  node ${process.version}  ·  ${platform()} ${release()}`,
  );
  info(`Registry:   ${reg}`);
  if (tokenPresent && who?.handle) {
    info(
      `Logged in:  @${who.handle}` +
        (who.token?.expiresAt ? `  (expires ${who.token.expiresAt})` : ""),
    );
    if (who.token?.scopes?.length)
      info(`Scopes:     ${who.token.scopes.join(", ")}`);
  } else if (tokenPresent) {
    info(`Logged in:  yes (registry unreachable — could not verify)`);
  } else {
    info(`Logged in:  no  (run \`oxp login\` to publish)`);
  }
  info(``);
  info(`Filesystem (OXP_HOME = ${home}):`);
  for (const p of paths) {
    const tag = p.present ? "✓" : "✗";
    info(`  ${tag} ${p.label.padEnd(22)} ${p.path}`);
  }
  info(``);
  info(`IDEs detected:`);
  if (adapters.length === 0) {
    info(
      `  (none)  — install VS Code, JetBrains, or Neovim to use OXP extensions`,
    );
  } else {
    for (const a of adapters) {
      const run = a.host.running ? " · running" : "";
      const part = a.host.partial ? " · partial" : "";
      let adapterTail: string;
      switch (a.status) {
        case "present":
          adapterTail = "adapter ✓";
          break;
        case "installed":
          adapterTail = "adapter installed";
          break;
        case "unsupported":
          adapterTail = "adapter ✗ (unsupported family)";
          break;
        case "unavailable":
          adapterTail = `adapter ⊘ (${a.reason})`;
          break;
        case "failed":
          adapterTail = `adapter ✗ (${a.error})`;
          break;
      }
      info(`  • ${a.host.displayName.padEnd(28)} ${adapterTail}${run}${part}`);
      if (a.host.cliPath) info(`      cli:  ${a.host.cliPath}`);
      if (a.host.userDataDir) info(`      data: ${a.host.userDataDir}`);
    }
  }
  info(``);
  info(`Next steps:`);
  if (!tokenPresent) info(`  • run \`oxp login\` to publish extensions`);
  if (
    adapters.every((a) => a.status !== "present" && a.status !== "installed")
  ) {
    info(
      `  • host adapters will auto-install once they're on the marketplaces`,
    );
  }
  info(`  • run \`oxp install <id>\` to install an extension`);
  info(`  • run \`oxp create <name>\` to start a new extension`);
  return 0;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface PathReport {
  label: string;
  path: string;
  present: boolean;
}

async function reportPaths(home: string): Promise<PathReport[]> {
  const items: { label: string; path: string }[] = [
    { label: "credentials", path: join(home, "credentials") },
    { label: "publisher key", path: join(home, "keys", "publisher.json") },
    { label: "host-store", path: join(home, "host-store") },
    { label: "  extensions/", path: join(home, "host-store", "extensions") },
    {
      label: "  url-installs/",
      path: join(home, "host-store", "url-installs"),
    },
    { label: "cache", path: join(home, "cache") },
    {
      label: "runtime (env)",
      path: process.env.OXP_RUNTIME ?? "(OXP_RUNTIME unset)",
    },
  ];
  const out: PathReport[] = [];
  for (const it of items) {
    const present = it.path.startsWith("(") ? false : await pathExists(it.path);
    out.push({ ...it, present });
  }
  return out;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

// Suppress unused-import warning when the helper above isn't used.
void homedir;
