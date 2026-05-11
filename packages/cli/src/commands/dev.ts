/**
 * `oxp dev [dir]` — watch a project, re-pack on changes, and serve the bundle
 * over WebSocket + HTTP so a host can hot-load the extension without going
 * through publish.
 *
 * Hosts that opt-in to dev mode (hosts/vscode/src/dev.ts, hosts/piye/src/dev.ts)
 * connect to:
 *
 *   ws://localhost:<port>/dev          → JSON {kind:"reload", manifest, digest, bundle:base64}
 *   GET http://localhost:<port>/manifest        → oxp.json
 *   GET http://localhost:<port>/bundle          → raw .oxp bytes
 *   GET http://localhost:<port>/info            → {dev:true, manifest, digest, bundleSize}
 *
 * IMPORTANT: dev mode SKIPS Ed25519 signing for speed. The host displays a
 * loud "DEV: signature bypass" badge while connected. Production publish flow
 * is unchanged.
 */
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import chokidar from "chokidar";
import { WebSocketServer, type WebSocket } from "ws";
import { packBundle } from "@oxprotocol/bundle";
import { findProjectRoot, fail, info } from "../util.js";
import { launchIdeForDev, takeNeovimBridge } from "../lib/ide-launch.js";
import { deleteEdhMarker } from "../lib/edh-marker.js";

interface DevState {
  manifest: Record<string, unknown>;
  digest: string;
  bundle: Buffer;
  builtAt: number;
}

/**
 * Bind the dev server to the requested port, but if it's already in use,
 * walk forward a few ports, then fall back to an OS-assigned free one.
 * Returns the port we actually ended up listening on.
 *
 * Why: a stale `oxp dev` (or another extension running concurrently) holding
 * 7373 should not crash the new session — that's a hostile dev experience.
 */
async function listenWithFallback(
  http: import("node:http").Server,
  preferred: number,
): Promise<number> {
  const tryListen = (port: number): Promise<number | "busy"> =>
    new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        http.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE") resolve("busy");
        else reject(err);
      };
      const onListening = () => {
        http.removeListener("error", onError);
        const addr = http.address();
        const actual = typeof addr === "object" && addr ? addr.port : port;
        resolve(actual);
      };
      http.once("error", onError);
      http.once("listening", onListening);
      http.listen(port, "127.0.0.1");
    });

  // Try the requested port, then a small forward range, then ephemeral (0).
  const candidates = [preferred, preferred + 1, preferred + 2, 0];
  for (const p of candidates) {
    const result = await tryListen(p);
    if (result !== "busy") {
      if (p !== preferred) {
        info(
          `port ${preferred} in use — using ${result} instead (set OXP_DEV_PORT to override)`,
        );
      }
      return result;
    }
  }
  // Should not happen — port 0 always succeeds — but be explicit.
  throw new Error("could not bind oxp dev to any port");
}

export async function dev(args: string[]): Promise<number> {
  // Parse args: [--port N] [--ide=<id>] [--debug] [dir]
  // Auto-launching the EDH window is non-negotiable: `oxp dev` always
  // detects the surrounding IDE and opens a fresh window. There is no
  // opt-out flag — the entire product is built around that one flow.
  let port = Number(process.env.OXP_DEV_PORT ?? 7373);
  let ideOverride: string | undefined = process.env.OXP_IDE;
  let debug = process.env.OXP_DEBUG === "1";
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--port" || a === "-p") {
      const v = args[++i];
      if (!v) fail("usage: oxp dev --port <n>");
      port = Number(v);
    } else if (a.startsWith("--port=")) {
      port = Number(a.slice("--port=".length));
    } else if (a === "--ide") {
      const v = args[++i];
      if (!v) fail("usage: oxp dev --ide <id>");
      ideOverride = v;
    } else if (a.startsWith("--ide=")) {
      ideOverride = a.slice("--ide=".length);
    } else if (a === "--debug") {
      debug = true;
    } else {
      positional.push(a);
    }
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    fail(`invalid port: ${port}`);
  }

  const startDir = resolve(positional[0] ?? process.cwd());
  const maybeRoot = await findProjectRoot(startDir);
  if (!maybeRoot) fail(`no oxp.json found at or above ${startDir}`);
  const root: string = maybeRoot;

  let state: DevState | null = null;
  let building = false;
  let pendingRebuild = false;

  async function rebuild(reason: string): Promise<void> {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    try {
      const t0 = Date.now();
      // Run the manifest's build hook (e.g. `npm run build`) before
      // packing, so React/TS templates that compile to ui/ get fresh
      // output. Skipped if no scripts.build is set. Mirrors `oxp pack`.
      const buildCmd = await readBuildScript(root);
      if (buildCmd) {
        const code = await runShell(buildCmd, root);
        if (code !== 0) {
          info(`✖ scripts.build exited ${code} — keeping previous bundle`);
          broadcast({ kind: "error", message: `build hook exit ${code}` });
          return;
        }
      }
      const r = await packBundle(root, {});
      state = {
        manifest: r.manifest as unknown as Record<string, unknown>,
        digest: r.bundleSha256,
        bundle: Buffer.from(r.oxp),
        builtAt: Date.now(),
      };
      const ms = Date.now() - t0;
      info(
        `↻ packed ${state.manifest.id}@${state.manifest.version} ` +
          `(${state.bundle.length} bytes, sha256:${state.digest.slice(0, 12)}…) ` +
          `in ${ms}ms — ${reason}`,
      );
      broadcast({
        kind: "reload",
        manifest: state.manifest,
        digest: state.digest,
        bundle: state.bundle.toString("base64"),
        builtAt: state.builtAt,
        dev: true,
      });
    } catch (err) {
      info(`✖ pack failed: ${(err as Error).message}`);
      broadcast({ kind: "error", message: (err as Error).message });
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        await rebuild("debounced");
      }
    }
  }

  // ── HTTP server ──────────────────────────────────────────────────────────
  const http = createServer((req, res) =>
    handleHttp(req, res, () => state, root),
  );

  // ── WebSocket server piggy-backs on HTTP ─────────────────────────────────
  const wss = new WebSocketServer({ server: http, path: "/dev" });
  // The wss attaches its own error listener to the http server; if the
  // first listen attempt fails with EADDRINUSE, that error re-emits on
  // the wss as well. listenWithFallback already handles the retry on
  // http, so swallow the duplicate here to avoid an uncaught crash.
  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") return;
    // Anything else is a real problem.
    process.emit("uncaughtException", err);
  });
  const sockets = new Set<WebSocket>();
  wss.on("connection", (ws) => {
    sockets.add(ws);
    info(`+ dev client connected (${sockets.size} total)`);
    if (state) {
      ws.send(
        JSON.stringify({
          kind: "reload",
          manifest: state.manifest,
          digest: state.digest,
          bundle: state.bundle.toString("base64"),
          builtAt: state.builtAt,
          dev: true,
        }),
      );
    }
    ws.on("close", () => {
      sockets.delete(ws);
      info(`- dev client disconnected (${sockets.size} total)`);
    });
    // Host-initiated messages — currently just "run this command".
    // We log + re-broadcast so any other connected client (including
    // the extension worker, once wired) can observe the dispatch. The
    // wire format is stable so SDK callers can rely on it now.
    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const m = msg as { kind?: unknown; id?: unknown };
      if (m.kind === "command" && typeof m.id === "string") {
        info(`▸ command requested: ${m.id}`);
        broadcast({ kind: "command", id: m.id });
      }
    });
  });

  function broadcast(msg: unknown): void {
    const json = JSON.stringify(msg);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
    // Neovim has no WS client in Lua; the bridge funnels every
    // broadcast into the EDH plugin via file + nvim-server-remote.
    // Installed below right after `launchIdeForDev`.
    if (neovimBridge) {
      try {
        neovimBridge.onBroadcast(msg as { kind: string });
      } catch {
        /* never let bridge errors take down the dev server */
      }
    }
  }
  let neovimBridge: ReturnType<typeof takeNeovimBridge> = null;

  // If the project has a `scripts.build` hook the `ui/` directory is
  // generated output (see hello-html template). Watching it would cause
  // an infinite rebuild loop. We watch `src/` and other source dirs
  // instead — chokidar still picks them up via the root walk.
  const hasBuildHook = (await readBuildScript(root)) != null;

  // ── chokidar watch ───────────────────────────────────────────────────────
  const watcher = chokidar.watch(root, {
    ignored: (p) =>
      /(^|[\\/])(\.git|node_modules|dist\/.*\.oxp|\.next|\.oxp-cache)([\\/]|$)/.test(
        p,
      ) ||
      // Generated build outputs — would cause infinite rebuild loops.
      // When a build hook exists, ignore the entire `ui/` tree (it's
      // 100% generated). Otherwise only ignore obvious bundler artefacts
      // so authors who hand-write `ui/index.html` still get hot reload.
      (hasBuildHook
        ? /(^|[\\/])ui([\\/]|$)/.test(p)
        : /[\\/]ui[\\/](main|index)\.(js|css|html)(\.map)?$/.test(p)),
    ignoreInitial: true,
  });
  let debounce: NodeJS.Timeout | null = null;
  watcher.on("all", (event, path) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void rebuild(`${event} ${path.replace(root + "/", "")}`);
    }, 100);
  });

  // ── Initial build + start ────────────────────────────────────────────────
  await rebuild("initial");
  port = await listenWithFallback(http, port);

  // Machine-readable line so IDE hosts can auto-detect when we're ready
  // (used by VS Code's "OXP: Start Dev Session" command).
  info(`OXP_DEV_READY port=${port}`);
  info("");
  info("oxp dev — backend ready. ⚠ DEV mode (signature bypass, do not ship)");
  info(`  watching: ${root}`);
  info("");

  {
    const wsUrl = `ws://127.0.0.1:${port}/dev`;
    const ok = launchIdeForDev(root, { ideOverride, debug, wsUrl });
    neovimBridge = takeNeovimBridge();
    info("");
    if (!ok) {
      info("Could not auto-detect your IDE. Override with:");
      info(
        "  --ide=<id>   cursor | windsurf | code | code-insiders | antigravity | vscodium | jetbrains | neovim | piye",
      );
    }
  }
  info("");
  info("Press Ctrl+C to stop.");

  // Keep alive until SIGINT.
  await new Promise<void>((resolveSig) => {
    const stop = async () => {
      info("\noxp dev: shutting down…");
      deleteEdhMarker();
      // Tell every connected EDH window to close itself before we
      // tear the WS server down. Without this the host extension
      // stays attached to a dead URL and the user has to close the
      // EDH window by hand. Mirrors VS Code's own detach-on-exit UX.
      broadcast({ kind: "shutdown" });
      // Give sockets a brief moment to flush the shutdown frame.
      await new Promise((r) => setTimeout(r, 50));
      // Tear down the Neovim bridge (rm -rf the session dir) AFTER the
      // shutdown broadcast — the plugin needs that final state.json
      // write before its session dir disappears.
      if (neovimBridge) {
        try {
          neovimBridge.dispose();
        } catch {
          /* ignore */
        }
        neovimBridge = null;
      }
      await watcher.close();
      for (const ws of sockets) ws.terminate();
      wss.close();
      http.close();
      resolveSig();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.on("exit", () => deleteEdhMarker());
  });
  return 0;
}

// ── HTTP handler ───────────────────────────────────────────────────────────
function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  getState: () => DevState | null,
  root: string,
): void {
  res.setHeader("access-control-allow-origin", "*");
  const url = new URL(req.url ?? "/", "http://localhost");
  const state = getState();
  switch (url.pathname) {
    case "/info":
      if (!state) return send(res, 503, { error: "not built yet" });
      return send(res, 200, {
        dev: true,
        manifest: state.manifest,
        digest: state.digest,
        bundleSize: state.bundle.length,
        builtAt: state.builtAt,
      });
    case "/manifest":
      if (!state) return send(res, 503, { error: "not built yet" });
      return send(res, 200, state.manifest);
    case "/bundle":
      if (!state) return send(res, 503, { error: "not built yet" });
      res.statusCode = 200;
      res.setHeader("content-type", "application/x-oxp+zstd");
      res.setHeader("x-oxp-digest", `sha256:${state.digest}`);
      res.setHeader("x-oxp-dev", "true");
      res.end(state.bundle);
      return;
    case "/":
      return send(res, 200, {
        service: "oxp dev",
        endpoints: ["/info", "/manifest", "/bundle", "/ui/<path>", "/dev (ws)"],
      });
    default:
      if (url.pathname.startsWith("/ui/")) {
        return serveProjectFile(res, root, url.pathname.slice("/ui/".length));
      }
      return send(res, 404, { error: "not found" });
  }
}

/**
 * Serve a file from inside the project root. Used by non-VS-Code hosts
 * (JetBrains JCEF, Piye, …) that can't decompress the zstd bundle in
 * their host language — they just point a browser at `/ui/<main.ui>`
 * and let HTTP handle resolution of relative asset URLs.
 *
 * Path-traversal guard: the resolved absolute path MUST be inside
 * `root`. We also strip query strings and refuse `..` segments.
 */
function serveProjectFile(
  res: ServerResponse,
  root: string,
  rel: string,
): void {
  // Decode percent-escapes, drop query, refuse absolute paths.
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return send(res, 400, { error: "bad path" });
  }
  if (!decoded || decoded.startsWith("/") || decoded.includes("\0")) {
    return send(res, 400, { error: "bad path" });
  }
  const normalized = normalize(decoded);
  if (normalized.split(/[\\/]/).includes("..")) {
    return send(res, 400, { error: "bad path" });
  }
  const abs = resolve(root, normalized);
  if (!(abs === root || abs.startsWith(root + sep))) {
    return send(res, 400, { error: "outside project root" });
  }
  res.setHeader("content-type", mimeOf(abs));
  res.setHeader("cache-control", "no-store");
  const stream = createReadStream(abs);
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err.code === "ENOENT" || err.code === "EISDIR") {
      return send(res, 404, { error: "not found" });
    }
    return send(res, 500, { error: err.message });
  });
  res.statusCode = 200;
  stream.pipe(res);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function mimeOf(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? "application/octet-stream";
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// ── Build hook helpers (mirror pack.ts) ───────────────────────────────────
async function readBuildScript(root: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(join(root, "oxp.json"), "utf8");
    const m = JSON.parse(raw) as { scripts?: { build?: unknown } };
    const cmd = m?.scripts?.build;
    if (typeof cmd === "string" && cmd.trim().length > 0) return cmd;
  } catch {
    /* ignore */
  }
  return null;
}

function runShell(cmd: string, cwd: string): Promise<number> {
  return new Promise((resolveExit) => {
    info(`▸ ${cmd}`);
    const child = spawn(cmd, {
      cwd,
      shell: true,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => resolveExit(code ?? 1));
    child.on("error", () => resolveExit(1));
  });
}
