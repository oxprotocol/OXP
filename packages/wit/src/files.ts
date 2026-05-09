import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalWorldSha256 } from "./canonical.js";
import {
  OXP_EXTENSION_PACKAGE,
  OXP_EXTENSION_VERSION,
  OXP_HOST_PACKAGE,
  OXP_HOST_VERSION,
} from "./version.js";

/**
 * Filesystem locator for the bundled .wit files. Used by the registry
 * (to verify uploads against the canonical hash) and by tests.
 *
 * Resolves paths relative to the compiled `dist/` next to `wit/` in
 * the published package layout (siblings under packages/wit/).
 *
 * Works under both ESM (`import.meta.url`) and CJS bundlers
 * (`__dirname`, e.g. when consumed by an esbuild --format=cjs target
 * such as the VS Code extension host).
 */
function moduleDir(): string {
  // ESM (Node + the registry/CLI): `import.meta.url` is the file URL of
  // this module. esbuild stubs `import.meta` to `{}` when bundling for
  // CJS (the VS Code extension host), so `import.meta.url` will be
  // undefined there — fall back to `__dirname`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaUrl: string | undefined = (import.meta as any)?.url;
  if (metaUrl) return dirname(fileURLToPath(metaUrl));
  if (typeof __dirname !== "undefined") return __dirname;
  return process.cwd();
}

const HERE = moduleDir();
const WIT_DIR = resolve(HERE, "..", "wit");

export interface WitFile {
  /** Path relative to the wit/ dir, e.g. "oxp-host.wit". */
  path: string;
  source: string;
}

export function readWitFile(name: string): WitFile {
  return { path: name, source: readFileSync(join(WIT_DIR, name), "utf8") };
}

/**
 * The full set of .wit files that make up the v0.1.0 contract.
 * Order is irrelevant for the hash (canonicalWorldSha256 sorts).
 */
export const WORLD_FILES = ["oxp-host.wit", "oxp-extension.wit"] as const;

export function readWorldFiles(): WitFile[] {
  return WORLD_FILES.map(readWitFile);
}

/**
 * The canonical sha256 of the v0.1.0 world as shipped by this build.
 * Computed lazily so consumers that only want the version constants
 * don't pay the disk read.
 */
let _worldHash: string | undefined;
export function worldSha256(): string {
  if (!_worldHash) _worldHash = canonicalWorldSha256(readWorldFiles());
  return _worldHash;
}

/**
 * Pinning record the manifest carries (Phase A.11).
 * The registry computes worldSha256() at upload time and rejects any
 * mismatch — this is the safety net that prevents a malicious bundle
 * from claiming "I target oxp:extension@0.1.0" while shipping a forged
 * world.wit file with extra imports.
 */
export interface WitPin {
  package: string; // e.g. "oxp:extension"
  version: string; // e.g. "0.1.0"
  sha256: string; // hex; matches worldSha256() at the pinned version
}

export function currentExtensionPin(): WitPin {
  return {
    package: OXP_EXTENSION_PACKAGE,
    version: OXP_EXTENSION_VERSION,
    sha256: worldSha256(),
  };
}

export function currentHostPin(): WitPin {
  return {
    package: OXP_HOST_PACKAGE,
    version: OXP_HOST_VERSION,
    sha256: worldSha256(),
  };
}
