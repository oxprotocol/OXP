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
import { join, resolve, isAbsolute, sep, dirname } from "node:path";
import { homedir, platform, release } from "node:os";
import { fileURLToPath } from "node:url";

import { detectHosts } from "../lib/host-detect.js";
import { ensureAdapters } from "../lib/host-adapter.js";
import {
  detectClients,
  listInstalledServers,
  type ClientTarget,
  type InstalledMcpServer,
} from "../lib/mcp-clients.js";
import { probeMcpServer, type ProbeResult } from "../lib/mcp-probe.js";
import {
  findProjectRoot,
  info,
  oxpHome,
  readCredentials,
  registryUrl,
} from "../util.js";

interface WhoamiResp {
  ok?: boolean;
  handle?: string | null;
  email?: string;
  token?: { scopes?: string[]; expiresAt?: string | null };
}

interface McpServerHealth {
  slug: string;
  command: string;
  args: string[];
  reachable: boolean;
  reason?: string;
}

interface McpClientHealth {
  id: string;
  name: string;
  configPath: string;
  servers: McpServerHealth[];
}

const HELP = `oxp doctor [--json] [--project <dir>]   Inspect this machine and report what OXP can see

Flags:
  --json               Emit a machine-readable JSON report on a single line.
  --project <dir>      Also inspect the OXP project at <dir> for build-determinism
                       issues. Default: current working directory (if it contains
                       an oxp.json).
  --no-project         Skip project inspection even when cwd has an oxp.json.
`;

export async function doctor(args: string[]): Promise<number> {
  if (args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const json = args.includes("--json");
  const noProject = args.includes("--no-project");
  let projectArg: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project") projectArg = args[++i] ?? null;
    else if (a && a.startsWith("--project="))
      projectArg = a.slice("--project=".length);
  }

  const home = oxpHome();
  const reg = registryUrl();
  const cliVersion = await readCliVersion();
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

  // MCP client health — detect configured servers and probe reachability.
  // Each unique (command, args) pair is probed once in parallel.
  const mcpClients = await detectClients();
  const mcpHealth: McpClientHealth[] = [];
  if (mcpClients.length > 0) {
    const clientServers: Array<{ client: ClientTarget; servers: InstalledMcpServer[] }> = [];
    for (const c of mcpClients) {
      clientServers.push({ client: c, servers: await listInstalledServers(c) });
    }
    const probeCache = new Map<string, ProbeResult>();
    const toProbe = new Map<string, InstalledMcpServer>();
    for (const { servers } of clientServers) {
      for (const s of servers) {
        const key = `${s.entry.command}\0${s.entry.args.join("\0")}`;
        if (!toProbe.has(key)) toProbe.set(key, s);
      }
    }
    await Promise.all(
      Array.from(toProbe.entries()).map(async ([key, s]) => {
        const r = await probeMcpServer(s.entry.command, s.entry.args, s.entry.env);
        probeCache.set(key, r);
      }),
    );
    for (const { client: c, servers } of clientServers) {
      mcpHealth.push({
        id: c.id,
        name: c.displayName,
        configPath: c.configPath,
        servers: servers.map((s) => {
          const key = `${s.entry.command}\0${s.entry.args.join("\0")}`;
          const probe = probeCache.get(key) ?? { ok: false, reason: "probe not run" };
          return {
            slug: s.slug,
            command: s.entry.command,
            args: s.entry.args,
            reachable: probe.ok,
            reason: probe.reason,
          };
        }),
      });
    }
  }

  // Project inspection (build-determinism). Off by default only when the
  // user explicitly passes --no-project. When --project is given we use
  // that path; otherwise we look for an oxp.json at or above cwd.
  let project: ProjectReport | null = null;
  if (!noProject) {
    const start = projectArg ? resolve(projectArg) : process.cwd();
    const root = await findProjectRoot(start);
    if (root) project = await reportProject(root);
    else if (projectArg) {
      // Explicit --project but nothing found — surface as an error-shaped
      // report rather than silently skipping.
      project = {
        root: start,
        found: false,
        checks: [],
      };
    }
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        cli: {
          version: cliVersion,
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
        mcp: mcpHealth,
        project,
      }) + "\n",
    );
    return 0;
  }

  info(`OXP doctor`);
  info(`──────────────────────────────────────────────────────────`);
  info(
    `CLI:        v${cliVersion}  ·  node ${process.version}  ·  ${platform()} ${release()}`,
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
  renderMcp(mcpHealth);
  if (project) renderProject(project);
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

async function readCliVersion(): Promise<string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/commands/doctor.js → ../../package.json
    const raw = await fs.readFile(join(here, "..", "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

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

/* -------------------------------------------------------------------------- */
/* Project inspection — build-determinism checks                              */
/* -------------------------------------------------------------------------- */
//
// A bundle is only reproducible across machines when the *inputs* are.
// `oxp pack` itself is deterministic, but it shells out to the author's
// `scripts.build` hook, which is wide-open. The checks below flag the
// most common cross-machine drift causes: missing lockfile, unpinned
// Node engine, generated outputs not gitignored, missing rust toolchain
// pin for WASM projects, broken icon path, etc.
//
// Severity legend in the text report:
//   ✓  ok           — no action needed
//   !  warning      — likely to cause drift across machines or CI
//   ✗  error        — broken right now (file missing, JSON invalid, …)
//   ·  info         — neutral fact

type CheckLevel = "ok" | "warn" | "error" | "info";

interface ProjectCheck {
  id: string;
  level: CheckLevel;
  label: string;
  detail?: string;
}

interface ProjectReport {
  root: string;
  found: boolean;
  manifestId?: string;
  manifestVersion?: string;
  checks: ProjectCheck[];
}

async function reportProject(root: string): Promise<ProjectReport> {
  const checks: ProjectCheck[] = [];
  let manifestId: string | undefined;
  let manifestVersion: string | undefined;
  let manifest: Record<string, unknown> | null = null;

  // 1. oxp.json — parseable?
  try {
    const raw = await fs.readFile(join(root, "oxp.json"), "utf8");
    manifest = JSON.parse(raw) as Record<string, unknown>;
    manifestId =
      typeof manifest.id === "string" ? (manifest.id as string) : undefined;
    manifestVersion =
      typeof manifest.version === "string"
        ? (manifest.version as string)
        : undefined;
    checks.push({
      id: "manifest",
      level: "ok",
      label: "oxp.json",
      detail: `${manifestId ?? "(no id)"}@${manifestVersion ?? "?"}`,
    });
  } catch (err) {
    checks.push({
      id: "manifest",
      level: "error",
      label: "oxp.json",
      detail: `unreadable: ${(err as Error).message}`,
    });
  }

  // 2. Icon path validity (oxp.json#icon, used by the activity bar).
  if (manifest && typeof manifest.icon === "string" && manifest.icon.trim()) {
    const rel = (manifest.icon as string).trim();
    if (isAbsolute(rel) || rel.includes("..")) {
      checks.push({
        id: "icon",
        level: "error",
        label: "icon",
        detail: `unsafe path (must be relative, no '..'): ${rel}`,
      });
    } else {
      const abs = join(root, rel);
      if (!abs.startsWith(root + sep)) {
        checks.push({
          id: "icon",
          level: "error",
          label: "icon",
          detail: `points outside project: ${rel}`,
        });
      } else if (!(await pathExists(abs))) {
        checks.push({
          id: "icon",
          level: "error",
          label: "icon",
          detail: `file not found: ${rel}`,
        });
      } else {
        checks.push({
          id: "icon",
          level: "ok",
          label: "icon",
          detail: rel,
        });
        // Activity-bar icons are mask-rendered (monochrome) in every
        // VS Code fork. Multi-colour / gradient SVGs collapse into a
        // silhouette at 24×24 — warn so authors don't think the icon
        // wiring is broken when they see a solid blob in the rail.
        try {
          const svg = await fs.readFile(abs, "utf8");
          const monoIssues = scanForActivityBarIconIssues(svg);
          if (monoIssues.length > 0) {
            checks.push({
              id: "icon-monochrome",
              level: "warn",
              label: "icon (activity bar)",
              detail:
                `renders as a monochrome silhouette in the activity bar — ` +
                monoIssues.join(", ") +
                `. Use a single-colour path with fill="currentColor" for crisp rendering.`,
            });
          }
        } catch {
          /* unreadable — already flagged elsewhere */
        }
      }
    }
  } else {
    checks.push({
      id: "icon",
      level: "info",
      label: "icon",
      detail: "not set (using default OXP brand)",
    });
  }

  // 3. Lockfile — the single biggest determinism gap.
  const lockCandidates = [
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
  ];
  let lockfile: string | null = null;
  for (const f of lockCandidates) {
    if (await pathExists(join(root, f))) {
      lockfile = f;
      break;
    }
  }
  const hasPkgJson = await pathExists(join(root, "package.json"));
  if (lockfile) {
    checks.push({
      id: "lockfile",
      level: "ok",
      label: "lockfile",
      detail: lockfile,
    });
  } else if (hasPkgJson) {
    checks.push({
      id: "lockfile",
      level: "warn",
      label: "lockfile",
      detail:
        "no lockfile — npm/pnpm install may resolve different versions on other machines",
    });
  } else {
    checks.push({
      id: "lockfile",
      level: "info",
      label: "lockfile",
      detail: "no package.json (skipped)",
    });
  }

  // 4. Node engine pin in package.json.
  if (hasPkgJson) {
    try {
      const raw = await fs.readFile(join(root, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as {
        engines?: { node?: string };
        scripts?: Record<string, string>;
      };
      const nodePin = pkg.engines?.node;
      if (nodePin) {
        checks.push({
          id: "node-engine",
          level: "ok",
          label: "engines.node",
          detail: nodePin,
        });
      } else {
        checks.push({
          id: "node-engine",
          level: "warn",
          label: "engines.node",
          detail:
            "unset — bundlers may emit different output across Node majors",
        });
      }
    } catch {
      checks.push({
        id: "node-engine",
        level: "error",
        label: "package.json",
        detail: "unreadable",
      });
    }
  }

  // 5. scripts.build hook — present?
  const buildCmd =
    manifest &&
    typeof (manifest.scripts as Record<string, unknown> | undefined)?.build ===
      "string"
      ? ((manifest.scripts as Record<string, string>).build as string)
      : null;
  if (buildCmd) {
    checks.push({
      id: "build-script",
      level: "info",
      label: "scripts.build",
      detail: buildCmd,
    });
  } else {
    checks.push({
      id: "build-script",
      level: "info",
      label: "scripts.build",
      detail: "(none — bundle uses source as-is)",
    });
  }

  // 6. Generated outputs gitignored? Only relevant when a build hook
  //    exists; otherwise `ui/` is hand-written and should be committed.
  if (buildCmd) {
    let gi = "";
    try {
      gi = await fs.readFile(join(root, ".gitignore"), "utf8");
    } catch {
      /* fine — checked below */
    }
    const ignores = new Set(
      gi
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );
    const wantsIgnored = ["dist", "ui"];
    const missing = wantsIgnored.filter(
      (d) =>
        !ignores.has(d) &&
        !ignores.has(`${d}/`) &&
        !ignores.has(`/${d}`) &&
        !ignores.has(`/${d}/`),
    );
    if (missing.length === 0) {
      checks.push({
        id: "gitignore",
        level: "ok",
        label: ".gitignore",
        detail: "covers generated dist/ and ui/",
      });
    } else {
      checks.push({
        id: "gitignore",
        level: "warn",
        label: ".gitignore",
        detail: `missing entries: ${missing.join(", ")} (build outputs should not be committed)`,
      });
    }
  }

  // 7. Rust toolchain pin for WASM projects.
  const hasCargo = await pathExists(join(root, "Cargo.toml"));
  if (hasCargo) {
    const pinned =
      (await pathExists(join(root, "rust-toolchain.toml"))) ||
      (await pathExists(join(root, "rust-toolchain")));
    if (pinned) {
      checks.push({
        id: "rust-toolchain",
        level: "ok",
        label: "rust-toolchain",
        detail: "pinned",
      });
    } else {
      checks.push({
        id: "rust-toolchain",
        level: "warn",
        label: "rust-toolchain",
        detail:
          "no rust-toolchain.toml — different rustc/cargo-component versions produce different .wasm bytes",
      });
    }
  }

  // 8. node_modules present when a build hook needs it.
  if (buildCmd && hasPkgJson) {
    const hasNodeModules = await pathExists(join(root, "node_modules"));
    if (!hasNodeModules) {
      checks.push({
        id: "node-modules",
        level: "warn",
        label: "node_modules",
        detail: "missing — run install before `oxp pack` / `oxp dev`",
      });
    }
  }

  return {
    root,
    found: true,
    manifestId,
    manifestVersion,
    checks,
  };
}

function renderMcp(health: McpClientHealth[]): void {
  info(`MCP servers:`);
  if (health.length === 0) {
    info(
      `  (none) — install Claude Desktop, Cursor, VS Code, or Windsurf to use MCP`,
    );
    info(``);
    return;
  }
  let anyServers = false;
  for (const c of health) {
    if (c.servers.length === 0) continue;
    anyServers = true;
    info(`  ${c.name}  (${c.configPath})`);
    for (const s of c.servers) {
      const reach = s.reachable
        ? `reachable ✓`
        : `not reachable — ${s.reason ?? "unknown"}`;
      info(`    • ${s.slug.padEnd(30)} ${reach}`);
    }
  }
  if (!anyServers) {
    info(`  (no servers configured — run \`oxp install @publisher/server\` to add one)`);
  }
  info(``);
}

function renderProject(p: ProjectReport): void {
  info(`Project (build determinism):`);
  if (!p.found) {
    info(`  ✗ no oxp.json at ${p.root}`);
    info(``);
    return;
  }
  info(
    `  root: ${p.root}` +
      (p.manifestId ? `   (${p.manifestId}@${p.manifestVersion ?? "?"})` : ""),
  );
  for (const c of p.checks) {
    const glyph =
      c.level === "ok"
        ? "✓"
        : c.level === "warn"
          ? "!"
          : c.level === "error"
            ? "✗"
            : "·";
    info(`  ${glyph} ${c.label.padEnd(18)}` + (c.detail ? ` ${c.detail}` : ""));
  }
  const warns = p.checks.filter(
    (c) => c.level === "warn" || c.level === "error",
  );
  if (warns.length === 0) {
    info(`  → bundle should reproduce byte-for-byte on another machine.`);
  } else {
    info(
      `  → ${warns.length} issue${warns.length === 1 ? "" : "s"} may cause cross-machine drift.`,
    );
  }
  info(``);
}

/**
 * Quick heuristic for "this SVG will render badly as a VS Code activity-bar
 * icon". Activity-bar icons are mask-rendered: fills/gradients/filters are
 * discarded, only geometry + alpha matter. Multi-colour SVGs collapse into
 * a solid silhouette. We flag the common giveaways so authors don't think
 * the icon wiring is broken.
 *
 * Pure string scan — no XML parser — so the runtime cost is trivial.
 */
function scanForActivityBarIconIssues(svg: string): string[] {
  const issues: string[] = [];
  if (/<linearGradient\b|<radialGradient\b/i.test(svg)) {
    issues.push("contains gradients");
  }
  if (/<filter\b/i.test(svg)) {
    issues.push("contains filters");
  }
  // Collect every explicit fill colour (skip "none", url(...), currentColor).
  const fills = new Set<string>();
  const fillRe = /fill\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = fillRe.exec(svg))) {
    const v = (m[1] ?? "").trim().toLowerCase();
    if (!v || v === "none" || v === "currentcolor" || v.startsWith("url(")) {
      continue;
    }
    fills.add(v);
  }
  if (fills.size > 1) {
    issues.push(`${fills.size} distinct fill colours`);
  }
  return issues;
}
