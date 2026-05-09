import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { unpackBundle, signSigstore } from "@oxprotocol/bundle";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  fail,
  info,
  readCredentials,
  registryUrl,
  findProjectRoot,
} from "../util.js";

/**
 * `oxp publish [bundle] [--dry-run] [--json] [--no-prepublish]` — POST a
 * `.oxp` + signature to the registry.
 *
 * If <bundle> is omitted, the most recent `dist/*.oxp` in the current project
 * is used.
 *
 * Flags:
 *   --dry-run         Validate everything (bundle exists, signature + public
 *                     key files exist, manifest parses, target URL resolves)
 *                     but do NOT send the POST. Useful in CI to catch broken
 *                     bundles before they consume publish-rate budget.
 *   --json            Emit a single-line JSON record instead of human prose.
 *   --no-prepublish   Skip running `oxp.json#scripts.prepublish` (default: run it).
 */
export async function publish(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const noPrepublish = args.includes("--no-prepublish");
  const sigstoreFlag = args.includes("--sigstore");
  const noSigstore = args.includes("--no-sigstore");
  const oidcTokenArg = readFlagValue(args, "--oidc-token");
  const positional = args.filter((a) => !a.startsWith("--"));

  // --dry-run does not require credentials — it never talks to the registry.
  const token = dryRun ? null : await readCredentials();
  if (!dryRun && !token) fail("not logged in. run `oxp login` first");

  const bundlePath = await resolveBundle(positional[0]);
  const sigPath = bundlePath.replace(/\.oxp$/, ".sig.json");
  const pubPath = bundlePath.replace(/\.oxp$/, ".pub.pem");

  const [oxpBytes, sigText, pubText] = await Promise.all([
    fs.readFile(bundlePath),
    fs.readFile(sigPath, "utf8"),
    fs.readFile(pubPath, "utf8"),
  ]);

  // Read the manifest out of the bundle to learn id + version → URL path.
  const tmp = await mkdtemp(join(tmpdir(), "oxp-publish-"));
  let publisher: string;
  let slug: string;
  let version: string;
  try {
    const u = await unpackBundle(oxpBytes, tmp);
    publisher = u.manifest.publisher;
    const idSlug = u.manifest.id.split("/")[1];
    if (!idSlug) fail(`bad manifest id: ${u.manifest.id}`);
    slug = idSlug;
    version = u.manifest.version;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const url = `${registryUrl()}/api/v1/extensions/${publisher}/${slug}/versions`;

  if (dryRun) {
    const summary = {
      ok: true,
      dryRun: true,
      bundle: bundlePath,
      bytes: oxpBytes.length,
      target: url,
      manifest: { publisher, slug, version },
    };
    if (json) {
      process.stdout.write(JSON.stringify(summary) + "\n");
    } else {
      info(`✓ dry-run for @${publisher}/${slug}@${version}`);
      info(`  bundle:    ${bundlePath} (${oxpBytes.length} bytes)`);
      info(`  signature: ${sigPath}`);
      info(`  pubkey:    ${pubPath}`);
      info(`  target:    ${url}`);
      info(`  (no network request was made)`);
    }
    return 0;
  }

  // Run scripts.prepublish (if set) after a successful pack and before upload.
  if (!noPrepublish) {
    const root = await findProjectRoot(process.cwd());
    if (root) {
      const cmd = await readPrepublishScript(root);
      if (cmd) {
        if (!json) info(`▶ scripts.prepublish: ${cmd}`);
        const code = await runShell(cmd, root);
        if (code !== 0) {
          fail(`scripts.prepublish exited with code ${code}`);
        }
      }
    }
  }

  const form = new FormData();
  form.append(
    "bundle",
    new Blob([new Uint8Array(oxpBytes)], {
      type: "application/vnd.oxp.bundle.v1.tar+zstd",
    }),
    basename(bundlePath),
  );
  form.append("signature", sigText);
  form.append("publicKey", pubText);

  // Phase B.5b — optional Sigstore keyless co-signature.
  // - explicit `--sigstore` forces it (errors if no OIDC token available)
  // - explicit `--no-sigstore` disables it
  // - default: auto-enable when running on GitHub Actions with id-token
  //   permission (the Action token is available for free)
  if (!noSigstore) {
    const wantSigstore =
      sigstoreFlag ||
      !!oidcTokenArg ||
      (!!process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
        !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
    if (wantSigstore) {
      try {
        const sig = JSON.parse(sigText) as {
          payload: { digest: string; signedAt: string };
        };
        const payloadBytes = Buffer.from(JSON.stringify(sig.payload), "utf8");
        const identityToken =
          oidcTokenArg ?? (await fetchGithubActionsOidcToken());
        if (!identityToken) {
          fail(
            "--sigstore requires an OIDC identity token. Pass --oidc-token <jwt> or run on GitHub Actions with `permissions: { id-token: write }`.",
          );
        }
        if (!json) info("▶ sigstore: requesting cert from Fulcio…");
        const sigstoreBundle = await signSigstore(payloadBytes, {
          identityToken,
        });
        form.append("sigstoreBundle", JSON.stringify(sigstoreBundle));
        // Persist alongside the bundle for offline re-verification.
        const sigstorePath = bundlePath.replace(/\.oxp$/, ".sigstore.json");
        await fs.writeFile(
          sigstorePath,
          JSON.stringify(sigstoreBundle, null, 2),
        );
        if (!json) info(`✓ sigstore bundle: ${sigstorePath}`);
      } catch (e) {
        fail(`sigstore signing failed: ${(e as Error).message}`);
      }
    }
  }

  if (!json) info(`POST ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token!}` },
    body: form,
  });
  const body = await res.text();

  if (!res.ok) {
    if (json) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          status: res.status,
          statusText: res.statusText,
          body,
        }) + "\n",
      );
    } else {
      process.stderr.write(`oxp: ${res.status} ${res.statusText}\n${body}\n`);
    }
    return 1;
  }
  if (json) {
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* keep as string */
    }
    process.stdout.write(
      JSON.stringify({ ok: true, publisher, slug, version, response: parsed }) +
        "\n",
    );
  } else {
    info(`✓ published @${publisher}/${slug}@${version}`);
    info(body);
  }
  return 0;
}

async function resolveBundle(arg: string | undefined): Promise<string> {
  if (arg) return resolve(arg);
  const root = await findProjectRoot(process.cwd());
  if (!root) fail("not inside an OXP project. pass a bundle path explicitly");
  const distDir = join(root, "dist");
  let entries: string[];
  try {
    entries = (await fs.readdir(distDir)).filter((n) => n.endsWith(".oxp"));
  } catch {
    fail(`no dist/ directory in ${root}. run \`oxp pack\` first`);
  }
  if (entries.length === 0)
    fail("no .oxp files in dist/. run `oxp pack` first");

  const stats = await Promise.all(
    entries.map(async (n) => ({
      name: n,
      mtime: (await fs.stat(join(distDir, n))).mtimeMs,
    })),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return join(distDir, stats[0]!.name);
}

async function readPrepublishScript(root: string): Promise<string | null> {
  try {
    const txt = await fs.readFile(join(root, "oxp.json"), "utf8");
    const parsed = JSON.parse(txt) as { scripts?: { prepublish?: unknown } };
    const cmd = parsed.scripts?.prepublish;
    return typeof cmd === "string" && cmd.trim().length > 0 ? cmd.trim() : null;
  } catch {
    return null;
  }
}

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
        `oxp publish: prepublish hook failed to start: ${err.message}\n`,
      );
      resolveExit(1);
    });
  });
}

function readFlagValue(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    const v = args[idx + 1];
    if (v && !v.startsWith("--")) return v;
  }
  return undefined;
}

/**
 * Fetch a GitHub Actions OIDC identity token, audience=`sigstore`. Returns
 * null when not running on GitHub Actions or when `id-token: write`
 * permission is missing.
 */
async function fetchGithubActionsOidcToken(): Promise<string | undefined> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !tok) return undefined;
  const u = new URL(url);
  u.searchParams.set("audience", "sigstore");
  const res = await fetch(u, {
    headers: { authorization: `Bearer ${tok}` },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub OIDC token request failed: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as { value?: string };
  return body.value;
}
