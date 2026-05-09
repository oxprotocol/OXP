/**
 * `oxp token` — manage the bearer token stored in `~/.oxp/credentials`.
 *
 * Subcommands:
 *   oxp token rotate [--days N] [--name "label"] [--scope publish:@a/b ...]
 *
 * `rotate` POSTs to /api/v1/tokens/rotate with the current token, then
 * overwrites `~/.oxp/credentials` with the new secret returned by the
 * registry. The previous token continues to work for ROTATION_GRACE_MS
 * (5 min server-side) so a publish in flight does not break.
 *
 * If `--scope` is passed one or more times, the new token is NARROWED
 * to that subset. Without it the new token inherits all scopes from
 * the current token.
 */

import {
  readCredentials,
  writeCredentials,
  registryUrl,
  info,
} from "../util.js";

interface RotateArgs {
  days?: number;
  name?: string;
  scopes?: string[];
}

function parseRotate(args: string[]): RotateArgs | { error: string } {
  const out: RotateArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--days") {
      const v = args[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return { error: "--days must be a positive number" };
      out.days = Math.floor(n);
    } else if (a === "--name") {
      const v = args[++i];
      if (!v) return { error: "--name requires a value" };
      out.name = v;
    } else if (a === "--scope") {
      const v = args[++i];
      if (!v) return { error: "--scope requires a value" };
      (out.scopes ??= []).push(v);
    } else {
      return { error: `unknown flag: ${a}` };
    }
  }
  return out;
}

export async function token(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "rotate") return rotate(rest);
  process.stderr.write(
    "usage:\n  oxp token rotate [--days N] [--name LABEL] [--scope publish:@h/s ...]\n",
  );
  return 2;
}

async function rotate(args: string[]): Promise<number> {
  const parsed = parseRotate(args);
  if ("error" in parsed) {
    process.stderr.write(`oxp: ${parsed.error}\n`);
    return 2;
  }

  const current = await readCredentials();
  if (!current) {
    process.stderr.write(
      "oxp: no credentials on disk; run `oxp login` first\n",
    );
    return 1;
  }

  const url = registryUrl();
  info(`Rotating token at ${url}…`);

  const body: Record<string, unknown> = {};
  if (parsed.days !== undefined) body.ttlDays = parsed.days;
  if (parsed.name !== undefined) body.name = parsed.name;
  if (parsed.scopes !== undefined) body.scopes = parsed.scopes;

  let res: Response;
  try {
    res = await fetch(`${url}/api/v1/tokens/rotate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${current}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    process.stderr.write(`oxp: rotation request failed: ${(e as Error).message}\n`);
    return 1;
  }

  let payload: {
    ok?: boolean;
    error?: string;
    token?: string;
    tokenId?: string;
    scopes?: string[];
    expiresAt?: string | null;
    previousExpiresAt?: string;
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    process.stderr.write(
      `oxp: rotation returned ${res.status} with non-JSON body\n`,
    );
    return 1;
  }

  if (!res.ok || !payload.ok || !payload.token) {
    process.stderr.write(
      `oxp: rotation failed (${res.status}): ${payload.error ?? "unknown error"}\n`,
    );
    return 1;
  }

  await writeCredentials(payload.token);
  info("✓ new token saved to ~/.oxp/credentials");
  if (payload.scopes) info(`  scopes: ${payload.scopes.join(", ")}`);
  if (payload.expiresAt) info(`  expires: ${payload.expiresAt}`);
  if (payload.previousExpiresAt)
    info(`  old token valid until: ${payload.previousExpiresAt}`);
  return 0;
}
