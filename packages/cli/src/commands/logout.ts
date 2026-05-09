/**
 * `oxp logout [--keep-server]` — sign out of the registry on this machine.
 *
 * Default behaviour:
 *   1. Hit POST /api/v1/auth/logout to revoke the token server-side.
 *   2. Delete `~/.oxp/credentials`.
 *
 * With `--keep-server` the local file is removed but the token stays valid
 * on the registry — useful when rotating laptops without invalidating CI
 * jobs that share the same token.
 *
 * With `--local-only` (alias) only step 2 runs and no network call is made.
 *
 * Idempotent: succeeds (exit 0) even if no credentials file exists.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { info, oxpHome, readCredentials, registryUrl } from "../util.js";

export async function logout(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const localOnly =
    args.includes("--local-only") || args.includes("--keep-server");

  const token = await readCredentials();
  if (!token) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ ok: true, alreadyLoggedOut: true }) + "\n",
      );
    } else {
      info("Already logged out.");
    }
    return 0;
  }

  let serverRevoked: "yes" | "skipped" | "failed" = "skipped";
  if (!localOnly) {
    try {
      const res = await fetch(`${registryUrl()}/api/v1/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      serverRevoked = res.ok ? "yes" : "failed";
      if (!res.ok && !json) {
        process.stderr.write(
          `oxp: server revoke returned ${res.status}; deleting local credentials anyway\n`,
        );
      }
    } catch (err) {
      serverRevoked = "failed";
      if (!json) {
        process.stderr.write(
          `oxp: could not reach registry (${(err as Error).message}); deleting local credentials anyway\n`,
        );
      }
    }
  }

  // Always remove the local file last so a partial failure still leaves the
  // user in a consistent "not logged in" state on this machine.
  try {
    await fs.unlink(join(oxpHome(), "credentials"));
  } catch {
    // already gone — fine
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({ ok: true, serverRevoked, localRemoved: true }) + "\n",
    );
  } else {
    info("✓ Logged out.");
    if (serverRevoked === "failed") {
      info(
        "  (server token may still be valid — revoke it from /dashboard/tokens)",
      );
    }
  }
  return 0;
}
