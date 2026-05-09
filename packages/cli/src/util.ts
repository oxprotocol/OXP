/** Shared helpers for OXP CLI commands. */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function oxpHome(): string {
  return process.env.OXP_HOME ?? join(homedir(), ".oxp");
}

const DEFAULT_REGISTRY = "http://localhost:3000";
let warnedDefaultRegistry = false;

export function registryUrl(): string {
  const fromEnv = process.env.OXP_REGISTRY;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/+$/, "");
  }
  // Localhost default is convenient for self-host / dev, but if you're trying
  // to publish or install against the public registry it's almost always a
  // mistake. Warn once per process so it's visible without becoming spammy.
  if (!warnedDefaultRegistry) {
    warnedDefaultRegistry = true;
    process.stderr.write(
      `[oxp] OXP_REGISTRY not set — defaulting to ${DEFAULT_REGISTRY}. ` +
        `Set OXP_REGISTRY=https://… to target a different host.\n`,
    );
  }
  return DEFAULT_REGISTRY;
}

export async function readCredentials(): Promise<string | null> {
  try {
    const buf = await fs.readFile(join(oxpHome(), "credentials"), "utf8");
    return buf.trim() || null;
  } catch {
    return null;
  }
}

export async function writeCredentials(token: string): Promise<void> {
  const dir = oxpHome();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "credentials");
  await fs.writeFile(path, token + "\n", { mode: 0o600 });
}

/** Find the project root (first ancestor containing oxp.json). */
export async function findProjectRoot(start: string): Promise<string | null> {
  let cur = resolve(start);
  while (true) {
    try {
      await fs.access(join(cur, "oxp.json"));
      return cur;
    } catch {
      // continue
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export function info(msg: string): void {
  process.stdout.write(msg + "\n");
}

export function fail(msg: string): never {
  process.stderr.write(`oxp: ${msg}\n`);
  process.exit(1);
}
