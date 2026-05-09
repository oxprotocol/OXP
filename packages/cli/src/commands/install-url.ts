/**
 * `oxp install-url <url>` — install a raw `.wasm` component from a URL into
 * the shared host store, so any installed IDE host (VS Code, JetBrains)
 * can list and activate it without re-downloading.
 *
 * Source schemes:
 *   https://…wasm     always allowed
 *   file://…wasm      always allowed
 *   http://…wasm      only when --insecure-http (or host is localhost / 127.0.0.1 / ::1)
 *
 * Storage:
 *   $OXP_HOME/host-store/url-installs/<sha256>/bundle.wasm
 *   $OXP_HOME/host-store/url-installs/<sha256>/meta.json
 *
 * This sidesteps the registry / signature pipeline; the caller is trusting
 * the URL. Hosts still gate activation with the permission prompt before
 * loading the bytes into the runtime.
 */

import * as path from "node:path";
import * as os from "node:os";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  fetchBundle,
  FetchBundleError,
  recordUrlInstall,
  listUrlInstalls,
  urlInstallRoot,
} from "@oxprotocol/host-core";
import { unpackBundle } from "@oxprotocol/bundle";
import { fail, info, oxpHome } from "../util.js";

interface ParsedArgs {
  url?: string;
  list: boolean;
  json: boolean;
  insecureHttp: boolean;
  id?: string;
}

const HELP = `oxp install-url <url>     Install an OXP extension from a URL

Accepts either:
  - a raw .wasm component (Phase A; sha256 = wasm sha256), or
  - a signed .oxp registry bundle (zstd-tar; the inner main.wasm is
    extracted and stored, and the manifest's @publisher/slug@version
    becomes the suggested id).

Arguments:
  <url>                       https://, file:// (http:// requires --insecure-http
                              or a localhost host name)

Flags:
  --list                      List previously URL-installed extensions and exit
  --insecure-http             Permit http:// URLs (auto-enabled for localhost)
  --id <@scope/name>          Override the suggested extension id
  --json                      Emit a single JSON line on success

The wasm component is written to:
  \$OXP_HOME/host-store/url-installs/<sha256>/

Installed IDEs detect new URL installs the next time their OXP runtime panel
is opened. Cancel-safe: SIGINT before write leaves the store untouched.
`;

function parseArgs(args: string[]): ParsedArgs {
  let url: string | undefined;
  let list = false;
  let json = false;
  let insecureHttp = false;
  let id: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--list") list = true;
    else if (a === "--json") json = true;
    else if (a === "--insecure-http") insecureHttp = true;
    else if (a === "--id") {
      const v = args[++i];
      if (!v) fail("--id requires a value");
      id = v;
    } else if (a.startsWith("--id=")) id = a.slice("--id=".length);
    else if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a.startsWith("-")) fail(`unknown flag: ${a}`);
    else if (!url) url = a;
    else fail(`unexpected argument: ${a}`);
  }
  return { url, list, json, insecureHttp, id };
}

function isLocalhost(u: URL): boolean {
  return (
    u.hostname === "localhost" ||
    u.hostname === "127.0.0.1" ||
    u.hostname === "::1"
  );
}

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function detectKind(bytes: Uint8Array): "wasm" | "oxp" | "unknown" {
  if (startsWith(bytes, WASM_MAGIC)) return "wasm";
  if (startsWith(bytes, ZSTD_MAGIC)) return "oxp";
  return "unknown";
}

export async function installUrl(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  const root = path.join(oxpHome(), "host-store");

  if (opts.list) {
    const records = await listUrlInstalls(root);
    if (opts.json) {
      process.stdout.write(JSON.stringify(records, null, 2) + "\n");
    } else if (records.length === 0) {
      info(`(no URL installs yet — try: oxp install-url https://…wasm)`);
    } else {
      info(`URL installs in ${urlInstallRoot(root)}:`);
      for (const r of records) {
        info(
          `  ${r.suggestedId}  ${r.sha256.slice(0, 12)}…  ${r.size}b  ${r.installedAt}`,
        );
        info(`    ← ${r.sourceUrl}`);
      }
    }
    return 0;
  }

  if (!opts.url) {
    process.stderr.write(HELP);
    return 2;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(opts.url);
  } catch {
    fail(`not a valid URL: ${opts.url}`);
  }

  const allowInsecureHttp =
    opts.insecureHttp ||
    (parsedUrl.protocol === "http:" && isLocalhost(parsedUrl));

  await mkdir(root, { recursive: true });
  const fetchCacheDir = path.join(oxpHome(), "cache", "url-installs");
  await mkdir(fetchCacheDir, { recursive: true });

  if (!opts.json) info(`↓ fetching ${opts.url} …`);

  let fetched;
  try {
    fetched = await fetchBundle(opts.url, {
      cacheDir: fetchCacheDir,
      allowInsecureHttp,
      accept: "any",
      onProgress: opts.json
        ? undefined
        : (received, total) => {
            if (total != null && total > 0) {
              const pct = Math.round((received / total) * 100);
              process.stderr.write(`\r  ${received}/${total} (${pct}%)`);
            }
          },
    });
    if (!opts.json) process.stderr.write("\n");
  } catch (err) {
    if (err instanceof FetchBundleError) {
      fail(`fetch failed (${err.code}): ${err.message}`);
    }
    throw err;
  }

  // Detect what we got: raw .wasm component or .oxp (zstd-tar) registry bundle?
  const rawBytes = await readFile(fetched.componentPath);
  const kind = detectKind(rawBytes);
  if (kind === "unknown") {
    fail(
      `downloaded ${rawBytes.length} bytes but could not detect format (expected wasm or .oxp bundle)`,
    );
  }

  let wasmBytes: Uint8Array;
  let suggestedId: string | undefined = opts.id;
  let kindLabel: string;

  if (kind === "wasm") {
    wasmBytes = rawBytes;
    kindLabel = "wasm";
  } else {
    // .oxp bundle: unpack to a temp dir, locate manifest.main.wasm.
    if (!opts.json) info(`◇ unpacking .oxp bundle …`);
    const tmp = await mkdtemp(path.join(os.tmpdir(), "oxp-install-"));
    try {
      const { manifest } = await unpackBundle(Buffer.from(rawBytes), tmp);
      const wasmRel = manifest.main?.wasm;
      if (!wasmRel) {
        fail(
          `bundle ${manifest.id}@${manifest.version} has no main.wasm (declarative-only bundles are not yet installable via install-url)`,
        );
      }
      wasmBytes = new Uint8Array(await readFile(path.join(tmp, wasmRel)));
      // Prefer manifest's authoritative id over --id or @url/<basename>.
      suggestedId = opts.id ?? `${manifest.id}@${manifest.version}`;
      kindLabel = `bundle ${manifest.id}@${manifest.version}`;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  // sha256 stored in the host-store entry is the *wasm* sha — that's the
  // unit hosts load. The original `.oxp` URL is preserved as sourceUrl.
  const wasmSha = createHash("sha256").update(wasmBytes).digest("hex");
  const { dir, bundlePath, record } = await recordUrlInstall(
    root,
    Buffer.from(wasmBytes),
    {
      sha256: wasmSha,
      sourceUrl: fetched.sourceUrl,
      suggestedId,
    },
  );

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        kind: kind === "oxp" ? "oxp" : "wasm",
        suggestedId: record.suggestedId,
        sha256: record.sha256,
        size: record.size,
        sourceUrl: record.sourceUrl,
        bundlePath,
        dir,
      }) + "\n",
    );
  } else {
    info(`✓ installed ${record.suggestedId}  (${kindLabel})`);
    info(`  sha256:  ${record.sha256}`);
    info(`  size:    ${record.size} bytes`);
    info(`  bundle:  ${bundlePath}`);
    info(``);
    info(`Open the OXP runtime panel in VS Code or your JetBrains IDE`);
    info(`to activate it (it will appear in the URL-installs list).`);
  }
  return 0;
}
