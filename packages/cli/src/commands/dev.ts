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
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import chokidar from "chokidar";
import { WebSocketServer, type WebSocket } from "ws";
import { packBundle } from "@oxprotocol/bundle";
import { findProjectRoot, fail, info } from "../util.js";

interface DevState {
  manifest: Record<string, unknown>;
  digest: string;
  bundle: Buffer;
  builtAt: number;
}

export async function dev(args: string[]): Promise<number> {
  // Parse args: [--port N] [dir]
  let port = Number(process.env.OXP_DEV_PORT ?? 7373);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--port" || a === "-p") {
      const v = args[++i];
      if (!v) fail("usage: oxp dev --port <n>");
      port = Number(v);
    } else if (a.startsWith("--port=")) {
      port = Number(a.slice("--port=".length));
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
  const http = createServer((req, res) => handleHttp(req, res, () => state));

  // ── WebSocket server piggy-backs on HTTP ─────────────────────────────────
  const wss = new WebSocketServer({ server: http, path: "/dev" });
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
  });

  function broadcast(msg: unknown): void {
    const json = JSON.stringify(msg);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  // ── chokidar watch ───────────────────────────────────────────────────────
  const watcher = chokidar.watch(root, {
    ignored: (p) =>
      /(^|[\\/])(\.git|node_modules|dist\/.*\.oxp|\.next|\.oxp-cache)([\\/]|$)/.test(
        p,
      ),
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
  await new Promise<void>((r) => http.listen(port, "127.0.0.1", r));

  info("");
  info("╭───────────────────────────────────────────────────────────╮");
  info("│  oxp dev — DEV MODE (signature bypass, do not ship)       │");
  info(`│  ws:    ws://localhost:${port}/dev`.padEnd(60) + "│");
  info(`│  http:  http://localhost:${port}/info`.padEnd(60) + "│");
  info(`│  root:  ${root}`.padEnd(60) + "│");
  info("╰───────────────────────────────────────────────────────────╯");
  info("");
  info("Press Ctrl+C to stop.");

  // Keep alive until SIGINT.
  await new Promise<void>((resolveSig) => {
    const stop = async () => {
      info("\noxp dev: shutting down…");
      await watcher.close();
      for (const ws of sockets) ws.terminate();
      wss.close();
      http.close();
      resolveSig();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

// ── HTTP handler ───────────────────────────────────────────────────────────
function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  getState: () => DevState | null,
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
        endpoints: ["/info", "/manifest", "/bundle", "/dev (ws)"],
      });
    default:
      return send(res, 404, { error: "not found" });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
