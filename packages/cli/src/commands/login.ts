import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface, Interface as RLInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { writeCredentials, registryUrl, info } from "../util.js";

/**
 * `oxp login` — sign in to the registry.
 *
 * Two flows, picked by flag:
 *
 *   oxp login              → terminal flow (Expo / npm style)
 *                            prompts for email + password right here, POSTs
 *                            to /api/v1/auth/login, gets back an API token.
 *
 *   oxp login --browser    → device-flow (OAuth 2.0 RFC 8628)
 *                            shows a short code, opens /auth/device in a
 *                            real browser, polls /api/v1/auth/device/token
 *                            until the user clicks Approve. Use this when
 *                            you SSO / WebAuthn / don't want the password
 *                            on this machine at all.
 *
 * Either way, the resulting raw token is written to `~/.oxp/credentials`
 * (chmod 0600). The CLI sends it as `Authorization: Bearer <raw>`.
 */
export async function login(args: string[]): Promise<number> {
  const useBrowser = args.includes("--browser");
  return useBrowser ? loginBrowser(args) : loginTerminal(args);
}

// ── terminal flow ──────────────────────────────────────────────────────────

async function loginTerminal(_args: string[]): Promise<number> {
  const url = registryUrl();
  info(`Registry: ${url}`);
  info("Sign in with your OXP email + password.");
  info("(use `oxp login --browser` to sign in via the web instead)\n");

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const email = (await question(rl, "Email: ")).trim().toLowerCase();
    if (!email) {
      process.stderr.write("oxp: no email entered\n");
      return 1;
    }
    const password = await questionMasked(rl, "Password: ");
    if (!password) {
      process.stderr.write("oxp: no password entered\n");
      return 1;
    }

    const res = await fetch(`${url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.status === 401) {
      process.stderr.write("oxp: invalid email or password\n");
      return 1;
    }
    if (!res.ok) {
      const txt = await safeText(res);
      process.stderr.write(`oxp: login failed (${res.status}): ${txt}\n`);
      return 1;
    }

    const body = (await res.json()) as {
      token: string;
      scopes: string[];
      expiresAt: string;
      handle: string | null;
    };

    await writeCredentials(body.token);
    const who = body.handle ? `@${body.handle}` : "your account";
    info(`✓ Signed in as ${who}`);
    info(`  scopes:  ${body.scopes.join(", ") || "(none)"}`);
    info(`  expires: ${body.expiresAt}`);
    return 0;
  } finally {
    rl.close();
  }
}

function question(rl: RLInterface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/**
 * Read a line of input without echoing it. We can't use rl.question directly
 * because readline echoes back; instead we attach our own keypress reader,
 * collect bytes until newline, and emit asterisks (or nothing) for feedback.
 *
 * Falls back to plain question() when stdin isn't a TTY (CI, piped input).
 */
function questionMasked(rl: RLInterface, prompt: string): Promise<string> {
  if (!stdin.isTTY) return question(rl, prompt);

  return new Promise((resolve) => {
    stdout.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let buf = "";
    const onData = (data: string) => {
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (ch === "\n" || ch === "\r" || code === 4 /* ^D */) {
          stdout.write("\n");
          cleanup();
          resolve(buf);
          return;
        }
        if (code === 3 /* ^C */) {
          cleanup();
          stdout.write("\n");
          process.exit(130);
        }
        if (code === 127 || code === 8 /* backspace */) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (code < 32) continue; // ignore other control chars
        buf += ch;
        stdout.write("*");
      }
    };

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    }

    stdin.on("data", onData);
  });
}

// ── browser / device flow ──────────────────────────────────────────────────

interface StartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface PollSuccess {
  ok: true;
  token: string;
  scopes: string[];
  expiresAt: string;
  handle: string | null;
}

interface PollError {
  error: string;
}

async function loginBrowser(args: string[]): Promise<number> {
  const noBrowser = args.includes("--no-browser");
  const url = registryUrl();
  info(`Registry: ${url}`);

  const startRes = await fetch(`${url}/api/v1/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!startRes.ok) {
    const txt = await safeText(startRes);
    process.stderr.write(
      `oxp: failed to start device flow (${startRes.status}): ${txt}\n`,
    );
    return 1;
  }
  const start = (await startRes.json()) as StartResponse;

  process.stdout.write("\n");
  process.stdout.write(`  ${bold("Code:")}  ${bold(start.userCode)}\n`);
  process.stdout.write(`  Open:  ${start.verificationUriComplete}\n\n`);
  process.stdout.write(`  Waiting for approval (Ctrl+C to cancel)...\n`);

  if (!noBrowser) {
    tryOpenBrowser(start.verificationUriComplete);
  }

  const deadline = Date.now() + start.expiresIn * 1000;
  let interval = Math.max(1, start.interval) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    const pollRes = await fetch(`${url}/api/v1/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: start.deviceCode }),
    });

    let body: PollSuccess | PollError | null = null;
    try {
      body = (await pollRes.json()) as PollSuccess | PollError;
    } catch {
      continue;
    }

    if (pollRes.ok && body && "ok" in body && body.ok) {
      await writeCredentials(body.token);
      const who = body.handle ? `@${body.handle}` : "your account";
      info(`\n✓ Signed in as ${who}`);
      info(`  scopes:  ${body.scopes.join(", ") || "(none)"}`);
      info(`  expires: ${body.expiresAt}`);
      return 0;
    }

    const err = body && "error" in body ? body.error : "unknown_error";
    if (err === "authorization_pending") continue;
    if (err === "slow_down") {
      interval += 1000;
      continue;
    }
    if (err === "access_denied") {
      process.stderr.write("\noxp: access denied in browser\n");
      return 1;
    }
    if (err === "expired_token" || err === "already_consumed") {
      process.stderr.write(`\noxp: session ${err.replace("_", " ")}\n`);
      return 1;
    }
    process.stderr.write(`\noxp: device flow error: ${err}\n`);
    return 1;
  }

  process.stderr.write("\noxp: timed out waiting for approval\n");
  return 1;
}

function bold(s: string): string {
  return process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function tryOpenBrowser(target: string): void {
  const opener =
    process.platform === "darwin"
      ? { cmd: "open", args: [target] }
      : process.platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", target] }
        : { cmd: "xdg-open", args: [target] };
  try {
    const child = spawn(opener.cmd, opener.args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* swallow */
  }
}
