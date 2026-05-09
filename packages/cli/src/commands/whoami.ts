/**
 * `oxp whoami [--json]` — print the identity behind the local credentials.
 *
 * Hits GET /api/v1/auth/whoami with the stored bearer token and prints
 * handle, email, scopes, and expiry. Prints nothing sensitive (the token
 * itself is never echoed back).
 *
 * Exit codes:
 *   0  authenticated
 *   1  not logged in / token invalid / network error
 */

import { fail, info, readCredentials, registryUrl } from "../util.js";

interface WhoamiResponse {
  ok: true;
  handle: string | null;
  email: string;
  token: {
    id: string;
    name: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
  };
}

export async function whoami(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const token = await readCredentials();
  if (!token) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: "not_logged_in" }) + "\n",
      );
      return 1;
    }
    fail("not logged in. run `oxp login` first");
  }

  const url = `${registryUrl()}/api/v1/auth/whoami`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (json) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: "network_error",
          message: (err as Error).message,
        }) + "\n",
      );
      return 1;
    }
    fail(`network error: ${(err as Error).message}`);
  }

  if (res.status === 401) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: "invalid_token" }) + "\n",
      );
      return 1;
    }
    fail("local credentials are invalid or expired. run `oxp login` again");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (json) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: "http_error",
          status: res.status,
          body: text,
        }) + "\n",
      );
      return 1;
    }
    fail(`whoami failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as WhoamiResponse;
  if (json) {
    process.stdout.write(JSON.stringify(body) + "\n");
    return 0;
  }

  const who = body.handle ? `@${body.handle}` : "(no handle)";
  info(`Signed in as  ${who}`);
  info(`  email:      ${body.email}`);
  info(`  token:      ${body.token.name} (${body.token.id.slice(0, 8)}…)`);
  info(`  scopes:     ${body.token.scopes.join(", ") || "(none)"}`);
  info(`  expires:    ${body.token.expiresAt ?? "never"}`);
  if (body.token.lastUsedAt) {
    info(`  last used:  ${body.token.lastUsedAt}`);
  }
  return 0;
}
