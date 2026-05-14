/**
 * Probe an MCP stdio server by spawning it and attempting an MCP
 * `initialize` JSON-RPC handshake.
 *
 * Works for any server that speaks the MCP stdio transport:
 *   - Spawns command + args with an inherited-but-overridable env
 *   - Writes the initialize request to stdin then closes stdin
 *   - Reads stdout line-by-line looking for the JSON-RPC response
 *   - Kills the process (SIGTERM → SIGKILL) after responding or timing out
 *
 * Env vars that contain placeholder strings (like "YOUR_API_KEY") are
 * stripped before spawning so the process isn't launched with obviously
 * bad credentials.
 */

import { spawn } from "node:child_process";

const PROBE_TIMEOUT_MS = 8_000;

/** Markers that indicate an env value is still a placeholder. */
const PLACEHOLDER_RE = /^(YOUR_|<|REPLACE|CHANGE_ME|todo|example|xxx)/i;

export interface ProbeResult {
  ok: boolean;
  /** Human-readable failure reason; undefined on success. */
  reason?: string;
}

/**
 * Attempt an MCP `initialize` handshake with the given server spec.
 * Returns within PROBE_TIMEOUT_MS regardless of server behaviour.
 */
export async function probeMcpServer(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;

    function done(result: ProbeResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Graceful shutdown: SIGTERM then SIGKILL after 300 ms.
      try {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              if (child.exitCode === null) child.kill("SIGKILL");
            } catch {
              /* already gone */
            }
          }, 300);
        }
      } catch {
        /* process already exited */
      }
      resolve(result);
    }

    // Strip placeholder env values — launching with "YOUR_API_KEY" set is
    // worse than not setting it (some servers crash with a clear error message
    // that the probe would misinterpret as an unreachability signal).
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env ?? {})) {
      if (!PLACEHOLDER_RE.test(v)) cleanEnv[k] = v;
    }

    const child = spawn(command, args, {
      env: { ...process.env, ...cleanEnv },
      stdio: ["pipe", "pipe", "ignore"],
    });

    const timer = setTimeout(() => {
      done({
        ok: false,
        reason: "timed out — server did not respond to initialize (may need credentials)",
      });
    }, PROBE_TIMEOUT_MS);

    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      done({
        ok: false,
        reason:
          code === "ENOENT"
            ? `command not found: ${command}`
            : err.message,
      });
    });

    child.on("exit", (code) => {
      if (!settled) {
        done({
          ok: false,
          reason: `process exited early with code ${code ?? "null"}`,
        });
      }
    });

    // MCP initialize request (spec version 2024-11-05).
    const initRequest =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "oxp", version: "0.1.0" },
        },
      }) + "\n";

    try {
      child.stdin!.write(initRequest);
      child.stdin!.end();
    } catch {
      done({ ok: false, reason: "could not write to server stdin" });
      return;
    }

    let buf = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as {
            jsonrpc?: string;
            id?: number;
            result?: unknown;
            error?: { code: number; message: string };
          };
          if (msg.jsonrpc === "2.0" && msg.id === 1) {
            if (msg.result !== undefined) {
              done({ ok: true });
            } else if (msg.error) {
              done({ ok: false, reason: `MCP error ${msg.error.code}: ${msg.error.message}` });
            }
          }
        } catch {
          // Non-JSON startup output — some servers log to stdout before the
          // protocol starts. Keep buffering.
        }
      }
    });
  });
}
