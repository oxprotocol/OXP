/**
 * `oxp install <id>` — non-VS-Code install path.
 *
 * Drives the same `resolveAndVerify` + Phase A.4 prompt + `Store.install`
 * pipeline that the VS Code host uses, so signature, WIT pin, TOFU
 * pinning, and capability gating are identical.
 *
 * Install root: `$OXP_HOME/host-store/` (default `~/.oxp/host-store/`).
 * The on-disk layout is identical to a real host's globalStorage so a
 * Piye / vscode host pointed at the same root can read the install.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  Store,
  Grants,
  installWithConsent,
  VerifyError,
  type HostFs,
  type PermissionPromptDecision,
  type PermissionPromptFn,
  type PermissionPromptItem,
  type PermissionPromptRequest,
} from "@oxprotocol/host-core";
import { fail, info, oxpHome, registryUrl } from "../util.js";
import { detectHosts, type DetectedHost } from "../lib/host-detect.js";
import { ensureAdapters, type AdapterStatus } from "../lib/host-adapter.js";
import { broadcast } from "../lib/broadcast.js";
import { parseOxpUrl, OxpUrlError } from "../lib/oxp-url.js";
import { installVsx, type VsxInstallReport } from "../lib/vsx-install.js";
import {
  detectClients,
  mergeServerInto,
  type ClientTarget,
  type InstallReport as McpClientReport,
  type McpServerEntry,
} from "../lib/mcp-clients.js";

interface ParsedArgs {
  id?: string;
  yes: boolean;
  json: boolean;
  noDetect: boolean;
  noAdapter: boolean;
  hostFilter?: string[];
  fromUrl?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  let id: string | undefined;
  let yes = false;
  let json = false;
  let noDetect = false;
  let noAdapter = false;
  let fromUrl: string | undefined;
  const hostFilter: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-y" || a === "--yes") yes = true;
    else if (a === "--json") json = true;
    else if (a === "--no-detect") noDetect = true;
    else if (a === "--no-adapter") noAdapter = true;
    else if (a === "--host") {
      const v = args[++i];
      if (!v) fail("--host requires a value");
      hostFilter.push(v);
    } else if (a.startsWith("--host="))
      hostFilter.push(a.slice("--host=".length));
    else if (a === "--from") {
      const v = args[++i];
      if (!v) fail("--from requires an oxp:// URL");
      fromUrl = v;
    } else if (a.startsWith("--from=")) fromUrl = a.slice("--from=".length);
    else if (a.startsWith("oxp://")) fromUrl = a;
    else if (a.startsWith("-")) fail(`unknown flag: ${a}`);
    else if (!id) id = a;
    else fail(`unexpected argument: ${a}`);
  }
  return {
    id,
    yes,
    json,
    noDetect,
    noAdapter,
    hostFilter: hostFilter.length ? hostFilter : undefined,
    fromUrl,
  };
}

const HELP = `oxp install <id|oxp-url>     Install an extension from the registry

Arguments:
  <id>                @publisher/slug
  oxp://install/...   Deep-link form (used by oxp.dev install buttons)

Flags:
  --from <url>        Install from an oxp:// URL
  --host <id>         Limit smart-detect to a specific host id (repeatable)
  --no-detect         Skip IDE detection (install to shared store only)
  --no-adapter        Don't auto-install missing host adapters
  -y, --yes           Approve every requested permission without prompting
  --json              Emit a single JSON line on success (machine-readable)

Environment:
  OXP_TRUST_PUBLISHER Comma-separated publishers (e.g. "@aldgar,@oxprotocol")
                      whose extensions skip the consent prompt. Narrower
                      than --yes: only the listed publishers are trusted.
`;

export async function install(args: string[]): Promise<number> {
  if (args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const opts = parseArgs(args);

  // oxp:// URL takes precedence — parse it and merge into opts.
  if (opts.fromUrl) {
    try {
      const parsed = parseOxpUrl(opts.fromUrl);
      if (!opts.id) opts.id = parsed.id;
      if (parsed.hosts && !opts.hostFilter) opts.hostFilter = parsed.hosts;
    } catch (err) {
      if (err instanceof OxpUrlError) fail(err.message);
      throw err;
    }
  }

  if (!opts.id) {
    process.stderr.write(HELP);
    return 2;
  }
  if (!/^@[^/]+\/[^/]+$/.test(opts.id)) {
    fail(`bad id ${opts.id} — expected @publisher/slug`);
  }

  const root = path.join(oxpHome(), "host-store");
  await fs.mkdir(root, { recursive: true });
  const hostFs = nodeHostFs();
  const store = new Store(hostFs, root);
  const grants = new Grants(hostFs, root);

  // ── VSX-mirror short-circuit ────────────────────────────────────────────
  // Ask the registry whether this id is an Open VSX mirror. If so, delegate
  // to each detected IDE's `--install-extension` instead of running the
  // wasm verify/install pipeline (VSX entries have no signed bundle).
  const vsxMeta = await tryFetchVsxMeta(opts.id);
  if (vsxMeta) {
    let detected: DetectedHost[] = [];
    if (!opts.noDetect) {
      detected = await detectHosts();
      if (opts.hostFilter) {
        detected = detected.filter((h) => opts.hostFilter!.includes(h.id));
      }
    }
    const reports = installVsx(
      {
        namespace: vsxMeta.namespace,
        name: vsxMeta.name,
        version: vsxMeta.version,
      },
      detected,
    );
    const okCount = reports.filter((r) => r.status === "ok").length;
    const failed = reports.filter((r) => r.status === "failed");

    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          ok: failed.length === 0,
          kind: "vsx",
          id: opts.id,
          source: {
            namespace: vsxMeta.namespace,
            name: vsxMeta.name,
            version: vsxMeta.version,
          },
          installed: okCount,
          hosts: reports.map((r) => ({
            id: r.host.id,
            name: r.host.displayName,
            status: r.status,
            reason: r.reason,
          })),
        }) + "\n",
      );
    } else {
      info(
        `✓ VSX install: ${vsxMeta.namespace}.${vsxMeta.name}@${vsxMeta.version}`,
      );
      info(`  source: open-vsx.org`);
      printVsxSummary(reports);
      if (okCount === 0 && reports.length > 0) {
        info(`  (no hosts received the extension — see reasons above)`);
      }
      if (reports.length === 0) {
        info(`  no VS Code-family IDE detected; nothing to install`);
      }
    }
    return failed.length === 0 ? 0 : 1;
  }

  // ── MCP-server short-circuit ───────────────────────────────────
  // Ask the registry whether this id is an MCP server. If so, merge the
  // launcher spec into every detected MCP-aware client (Claude Desktop,
  // Cursor, VS Code Copilot, Windsurf). No WASM verify, no host adapters.
  const mcpMeta = await tryFetchMcpMeta(opts.id);
  if (mcpMeta) {
    const spec = mcpMeta.install[0]!;
    const slug = opts.id.split("/").pop()!.replace(/^@/, "");
    const entry: McpServerEntry = {
      command: spec.command,
      args: spec.args,
      ...(spec.env ? { env: spec.env } : {}),
    };
    let clients = await detectClients();
    if (opts.hostFilter) {
      clients = clients.filter((c) => opts.hostFilter!.includes(c.id));
    }
    const reports: McpClientReport[] = [];
    for (const c of clients) {
      reports.push(await mergeServerInto(c, slug, entry));
    }
    const okCount = reports.filter(
      (r) => r.status === "installed" || r.status === "updated",
    ).length;
    const failed = reports.filter((r) => r.status === "failed");

    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          ok: failed.length === 0,
          kind: "mcp",
          id: opts.id,
          server: slug,
          launcher: { command: entry.command, args: entry.args },
          clients: reports.map((r) => ({
            id: r.client.id,
            name: r.client.displayName,
            status: r.status,
            reason: r.reason,
          })),
        }) + "\n",
      );
    } else {
      info(`✓ MCP install: ${opts.id}`);
      info(`  launcher: ${entry.command} ${entry.args.join(" ")}`);
      if (spec.env && Object.keys(spec.env).length > 0) {
        info(
          `  env (placeholder — edit before use): ${Object.keys(spec.env).join(", ")}`,
        );
      }
      printMcpSummary(reports);
      if (clients.length === 0) {
        info(
          `  no MCP-aware client detected (Claude Desktop, Cursor, VS Code, Windsurf)`,
        );
        info(`  install one of those, then re-run: oxp install ${opts.id}`);
      } else if (okCount > 0) {
        info(`  restart the affected client(s) to load the new server.`);
      }
    }
    return failed.length === 0 ? 0 : 1;
  }

  // Trusted-publisher allowlist: `OXP_TRUST_PUBLISHER=@aldgar,@oxprotocol`
  // skips the consent prompt for those publishers only. Anyone else still
  // prompts. Intentionally narrower than `--yes` so dotfiles and CI scripts
  // can be unattended without granting blanket trust to unknown authors.
  const trustedPublisher = isPublisherTrusted(opts.id);

  try {
    const { record, prompted } = await installWithConsent({
      registry: registryUrl(),
      id: opts.id,
      store,
      grants,
      prompt: opts.yes || trustedPublisher ? allowAllPrompt() : ttyPrompt(),
    });

    // Smart host detection — discover IDEs, ensure adapters, broadcast.
    let detected: DetectedHost[] = [];
    let adapters: AdapterStatus[] = [];
    if (!opts.noDetect) {
      detected = await detectHosts();
      if (opts.hostFilter) {
        detected = detected.filter((h) => opts.hostFilter!.includes(h.id));
      }
      adapters = await ensureAdapters(detected, {
        reportOnly: opts.noAdapter,
      });
    }

    await broadcast({
      kind: "installed",
      id: record.id,
      version: record.version,
    });

    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          ok: true,
          id: record.id,
          version: record.version,
          path: store.resourcePath(record),
          prompted,
          hosts: adapters.map((a) => ({
            id: a.host.id,
            name: a.host.displayName,
            running: a.host.running,
            adapter: a.status,
          })),
        }) + "\n",
      );
    } else {
      info(`✓ installed ${record.id}@${record.version}`);
      info(`  path: ${store.resourcePath(record)}`);
      if (record.grantedPermissions?.length) {
        info(`  granted: ${record.grantedPermissions.join(", ")}`);
      }
      if (!opts.noDetect) printHostSummary(adapters);
    }
    return 0;
  } catch (err) {
    const code = err instanceof VerifyError ? err.code : "INSTALL_FAILED";
    const msg = (err as Error).message;
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ ok: false, code, error: msg }) + "\n",
      );
    } else {
      process.stderr.write(`oxp: ${code}: ${msg}\n`);
    }
    return 1;
  }
}

function printHostSummary(adapters: AdapterStatus[]): void {
  if (adapters.length === 0) {
    info(`  hosts: none detected (install lives in shared store only)`);
    return;
  }
  info(`  hosts:`);
  let needsManualPlugin = false;
  for (const a of adapters) {
    const runTag = a.host.running ? " (running)" : "";
    let tail: string;
    switch (a.status) {
      case "present":
        tail = "adapter ✓";
        break;
      case "installed":
        tail = "adapter installed now";
        break;
      case "unavailable":
        needsManualPlugin = true;
        tail = "adapter not installed (see below)";
        break;
      case "failed":
        needsManualPlugin = true;
        tail = `adapter install failed: ${a.error}`;
        break;
      case "unsupported":
        tail = "adapter not yet built for this host";
        break;
    }
    info(`    - ${a.host.displayName}${runTag} — ${tail}`);
  }
  if (needsManualPlugin) {
    info(``);
    info(`  One-time setup to see extensions inside your IDE:`);
    info(`    • VS Code / Cursor / Windsurf: search "OXP" in Extensions`);
    info(`    • JetBrains: Settings → Plugins → Marketplace → search "OXP"`);
    info(`  Already-installed extensions live at ~/.oxp/host-store/ and`);
    info(`  appear automatically once the OXP plugin is loaded.`);
  }
}

/**
 * `OXP_TRUST_PUBLISHER` env var: comma-separated list of `@publisher`
 * prefixes whose extensions install without an interactive consent prompt.
 * Example: `OXP_TRUST_PUBLISHER=@aldgar,@oxprotocol`.
 */
function isPublisherTrusted(id: string): boolean {
  const raw = process.env.OXP_TRUST_PUBLISHER;
  if (!raw) return false;
  const m = /^(@[^/]+)\//.exec(id);
  if (!m) return false;
  const publisher = m[1]!.toLowerCase();
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => entry === publisher || entry === publisher.slice(1));
}

/* -------------------------------------------------------------------------- */
/* VSX-mirror helpers                                                         */
/* -------------------------------------------------------------------------- */

interface VsxRegistryMeta {
  namespace: string;
  name: string;
  version: string;
  vsixUrl?: string | null;
  worksIn?: string[];
}

async function tryFetchVsxMeta(id: string): Promise<VsxRegistryMeta | null> {
  // id is `@publisher/slug` (validated upstream).
  const m = /^@([^/]+)\/(.+)$/.exec(id);
  if (!m) return null;
  const [, publisher, slug] = m;
  const url = `${registryUrl()}/api/v1/extensions/${encodeURIComponent(publisher!)}/${encodeURIComponent(slug!)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { vsx?: VsxRegistryMeta | null };
    if (!j.vsx) return null;
    if (!j.vsx.namespace || !j.vsx.name) return null;
    return j.vsx;
  } catch {
    // Network/DNS failure shouldn't poison the install — fall through to
    // the normal native install path which has its own error handling.
    return null;
  }
}

function printVsxSummary(reports: VsxInstallReport[]): void {
  if (reports.length === 0) return;
  info(`  hosts:`);
  for (const r of reports) {
    const tag =
      r.status === "ok"
        ? "installed ✓"
        : r.status === "skipped"
          ? `skipped (${r.reason ?? "unknown"})`
          : `failed: ${r.reason ?? "unknown"}`;
    info(`    - ${r.host.displayName} — ${tag}`);
  }
}

/* -------------------------------------------------------------------------- */
/* MCP-server helpers                                                         */
/* -------------------------------------------------------------------------- */

interface McpRegistryMeta {
  id: string;
  name: string;
  description: string;
  install: Array<{
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

async function tryFetchMcpMeta(id: string): Promise<McpRegistryMeta | null> {
  const m = /^@([^/]+)\/(.+)$/.exec(id);
  if (!m) return null;
  const [, scope, slug] = m;
  const url = `${registryUrl()}/api/v1/install/mcp/${encodeURIComponent(scope!)}/${encodeURIComponent(slug!)}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean } & McpRegistryMeta;
    if (!j.ok || !Array.isArray(j.install) || j.install.length === 0)
      return null;
    return j;
  } catch {
    return null;
  }
}

function printMcpSummary(reports: McpClientReport[]): void {
  if (reports.length === 0) return;
  info(`  clients:`);
  for (const r of reports) {
    const tag =
      r.status === "installed"
        ? "installed ✓"
        : r.status === "updated"
          ? "updated ✓"
          : r.status === "skipped"
            ? `skipped (${r.reason ?? "unknown"})`
            : `failed: ${r.reason ?? "unknown"}`;
    info(`    - ${r.client.displayName} — ${tag}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Node host-fs adapter                                                       */
/* -------------------------------------------------------------------------- */

function nodeHostFs(): HostFs {
  return {
    async exists(p: string): Promise<boolean> {
      try {
        await fs.stat(p);
        return true;
      } catch {
        return false;
      }
    },
    async mkdirp(p: string): Promise<void> {
      await fs.mkdir(p, { recursive: true });
    },
    async readFile(p: string): Promise<Uint8Array> {
      return await fs.readFile(p);
    },
    async writeFile(p: string, bytes: Uint8Array): Promise<void> {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, bytes);
    },
    async rm(p: string): Promise<void> {
      await fs.rm(p, { recursive: true, force: true });
    },
    join(...segments: string[]): string {
      return path.join(...segments);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Permission prompts                                                         */
/* -------------------------------------------------------------------------- */

function allowAllPrompt(): PermissionPromptFn {
  // Explicit `--yes` flag — user has acknowledged unattended install.
  // Still echoed so non-interactive logs show what was granted.
  return async (req) => {
    process.stderr.write(headerLines(req).join("\n") + "\n");
    for (const it of req.items) process.stderr.write(itemLine(it) + "\n");
    process.stderr.write("(--yes) granting all\n");
    return { kind: "grant", grantedRaw: req.items.map((i) => i.raw) };
  };
}

function ttyPrompt(): PermissionPromptFn {
  return async (req): Promise<PermissionPromptDecision> => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return {
        kind: "deny",
        reason:
          "non-interactive shell: re-run with --yes to grant every requested permission",
      };
    }
    const lines = headerLines(req);
    for (const l of lines) process.stdout.write(l + "\n");
    process.stdout.write("\nThis extension is requesting:\n");
    for (const it of req.items)
      process.stdout.write("  " + itemLine(it) + "\n");

    const choice = await ask("\nApprove? [a]ll / [c]ustomize / [d]eny: ", "d");
    const c = choice.trim().toLowerCase();
    if (c === "a" || c === "all" || c === "y" || c === "yes") {
      return { kind: "grant", grantedRaw: req.items.map((i) => i.raw) };
    }
    if (c === "c" || c === "customize") {
      const grantedRaw: string[] = [];
      for (const it of req.items) {
        const ans = await ask(
          `  ${it.raw}  — grant? [y/N]: `,
          it.previouslyGranted ? "y" : "n",
        );
        if (ans.trim().toLowerCase().startsWith("y")) grantedRaw.push(it.raw);
      }
      return { kind: "grant", grantedRaw };
    }
    return { kind: "deny", reason: "user denied at prompt" };
  };
}

function headerLines(req: PermissionPromptRequest): string[] {
  return [
    "",
    `OXP — install permission prompt`,
    `  ${req.displayName} (${req.extensionId}@${req.version})`,
    req.isUpgrade
      ? `  ⚠ version upgrade — new permissions appeared since the last prompt`
      : `  first-time install`,
  ];
}

function itemLine(it: PermissionPromptItem): string {
  const tag = it.previouslyGranted ? " [previously granted]" : "";
  const sens = `(${it.sensitivity})`;
  return `${it.raw} ${sens} — ${it.description}${tag}`;
}

function ask(question: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans || fallback);
    });
  });
}
