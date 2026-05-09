import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { packBundle, signEd25519 } from "@oxprotocol/bundle";
import { findProjectRoot, fail, info } from "../util.js";
import { loadOrCreateKey } from "./keygen.js";

/**
 * `oxp pack [dir]` — build a deterministic .oxp bundle from the project at
 * <dir> (default: cwd). Writes:
 *   dist/<slug>-<version>.oxp        — zstd-compressed deterministic tar
 *   dist/<slug>-<version>.sig.json   — Ed25519 signature payload
 *   dist/<slug>-<version>.pub.pem    — copy of the publisher public key
 *
 * Build hook: if `oxp.json#scripts.build` is set, it is executed via
 * `sh -c` with the project root as cwd before packing. Skip with --no-build.
 */
export async function pack(args: string[]): Promise<number> {
  const noBuild = args.includes("--no-build");
  const positional = args.filter((a) => a !== "--no-build");
  const startDir = resolve(positional[0] ?? process.cwd());
  const root = await findProjectRoot(startDir);
  if (!root) fail(`no oxp.json found at or above ${startDir}`);

  // Run scripts.build before packing (npm-style: always on, opt-out via --no-build).
  if (!noBuild) {
    const buildCmd = await readBuildScript(root);
    if (buildCmd) {
      info(`▶ scripts.build: ${buildCmd}`);
      const code = await runShell(buildCmd, root);
      if (code !== 0) {
        fail(`scripts.build exited with code ${code}`);
      }
    }
  }

  const result = await packBundle(root, {});

  const slug = result.manifest.id.split("/")[1]!;
  const distDir = join(root, "dist");
  await fs.mkdir(distDir, { recursive: true });

  const base = `${slug}-${result.manifest.version}`;
  const oxpPath = join(distDir, `${base}.oxp`);
  const sigPath = join(distDir, `${base}.sig.json`);
  const pubPath = join(distDir, `${base}.pub.pem`);

  // Sign the digest with the local key
  const key = await loadOrCreateKey();
  const signature = signEd25519(
    result.bundleSha256,
    key.privateKeyPem,
    key.publicKeyPem,
  );

  await Promise.all([
    fs.writeFile(oxpPath, new Uint8Array(result.oxp)),
    fs.writeFile(sigPath, JSON.stringify(signature, null, 2) + "\n"),
    fs.writeFile(pubPath, key.publicKeyPem),
  ]);

  info(`packed ${result.manifest.id}@${result.manifest.version}`);
  info(`  bundle:    ${oxpPath} (${result.oxp.byteLength} bytes)`);
  info(`  digest:    sha256:${result.bundleSha256}`);
  info(`  signature: ${sigPath}`);
  info(`  publicKey: ${pubPath}`);
  info(`  keyId:     ${signature.keyId}`);
  return 0;
}

/**
 * Read `scripts.build` from the project's `oxp.json`. Returns null if the
 * file is missing, malformed, or doesn't define a build hook. Errors are
 * deferred to `packBundle()` which re-parses and validates the manifest.
 */
async function readBuildScript(root: string): Promise<string | null> {
  try {
    const txt = await fs.readFile(join(root, "oxp.json"), "utf8");
    const parsed = JSON.parse(txt) as { scripts?: { build?: unknown } };
    const cmd = parsed.scripts?.build;
    return typeof cmd === "string" && cmd.trim().length > 0 ? cmd.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Run a shell command and stream its stdio to our parent. Returns the exit
 * code. We use `sh -c <cmd>` for shell features (&&, pipes) — the manifest
 * has already been parsed from a trusted on-disk file the user controls.
 */
function runShell(cmd: string, cwd: string): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn("sh", ["-c", cmd], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => resolveExit(code ?? 1));
    child.on("error", (err) => {
      process.stderr.write(
        `oxp pack: build hook failed to start: ${err.message}\n`,
      );
      resolveExit(1);
    });
  });
}
