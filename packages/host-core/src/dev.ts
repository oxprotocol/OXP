/**
 * Dev-mode bundle loader.
 *
 * Pairs with `oxp dev` (packages/cli/src/commands/dev.ts). Fetches a freshly
 * packed bundle from the dev server and unpacks it WITHOUT signature
 * verification. Returns the same VerifiedBundle shape so the rest of the
 * host code path (mount, render) is identical to production.
 *
 * SECURITY: Hosts MUST display a loud "DEV MODE — signature bypass" badge
 * any time a dev bundle is mounted. This loader is opt-in: production hosts
 * should refuse to call it unless the user explicitly enabled dev mode.
 */
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { decompress } from "fzstd";
import { extract } from "tar-stream";
import {
  type ManifestCommon,
  type VerifiedBundle,
  VerifyError,
} from "./types.js";

interface DevInfo {
  dev: true;
  manifest: ManifestCommon & Record<string, unknown>;
  digest: string;
  bundleSize: number;
  builtAt: number;
}

async function readTar(tar: Uint8Array): Promise<Map<string, Uint8Array>> {
  return await new Promise((resolve, reject) => {
    const files = new Map<string, Uint8Array>();
    const ex = extract();
    ex.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        if (header.type === "file") {
          files.set(header.name, new Uint8Array(Buffer.concat(chunks)));
        }
        next();
      });
      stream.on("error", reject);
      stream.resume();
    });
    ex.on("finish", () => resolve(files));
    ex.on("error", reject);
    Readable.from(Buffer.from(tar)).pipe(ex);
  });
}

/**
 * Fetch + unpack a dev bundle. `devUrl` is e.g. "http://localhost:7373".
 *
 * Returns a VerifiedBundle marked with `keyId: "dev:unsigned"` so downstream
 * code can branch on it for the dev badge.
 */
export async function loadDevBundle(devUrl: string): Promise<VerifiedBundle> {
  const base = devUrl.replace(/\/+$/, "");

  const infoRes = await fetch(`${base}/info`);
  if (!infoRes.ok) {
    throw new VerifyError(`dev /info ${infoRes.status}`, "DEV_INFO_FAILED");
  }
  const info = (await infoRes.json()) as DevInfo;
  if (!info.dev) {
    throw new VerifyError(
      `${devUrl} is not an oxp dev server (info.dev !== true)`,
      "DEV_NOT_DEV",
    );
  }

  const bundleRes = await fetch(`${base}/bundle`);
  if (!bundleRes.ok) {
    throw new VerifyError(
      `dev /bundle ${bundleRes.status}`,
      "DEV_BUNDLE_FAILED",
    );
  }
  const bundleBytes = new Uint8Array(await bundleRes.arrayBuffer());

  const tar = decompress(bundleBytes);
  const files = await readTar(tar);
  const manifestBytes = files.get("oxp.json");
  if (!manifestBytes) {
    throw new VerifyError("oxp.json missing from dev bundle", "NO_MANIFEST");
  }
  const manifest = JSON.parse(
    Buffer.from(manifestBytes).toString("utf8"),
  ) as ManifestCommon & Record<string, unknown>;

  const id = String(manifest.id);
  const [publisherWithAt, slug] = id.split("/");
  const publisher = (publisherWithAt ?? "@dev").replace(/^@/, "");

  return {
    id,
    version: String(manifest.version),
    publisher,
    slug: slug ?? "dev",
    manifest,
    files,
    tarSha256: info.digest,
    keyId: "dev:unsigned",
  };
}

/**
 * Decode an inline base64 dev bundle (sent via WS reload event) without
 * a second HTTP round-trip. Same shape as loadDevBundle().
 */
export async function decodeDevReload(msg: {
  manifest: ManifestCommon & Record<string, unknown>;
  digest: string;
  bundle: string;
}): Promise<VerifiedBundle> {
  const bundleBytes = new Uint8Array(Buffer.from(msg.bundle, "base64"));
  const tar = decompress(bundleBytes);
  const files = await readTar(tar);
  const id = String(msg.manifest.id);
  const [publisherWithAt, slug] = id.split("/");
  const publisher = (publisherWithAt ?? "@dev").replace(/^@/, "");
  return {
    id,
    version: String(msg.manifest.version),
    publisher,
    slug: slug ?? "dev",
    manifest: msg.manifest,
    files,
    tarSha256: msg.digest,
    keyId: "dev:unsigned",
  };
}
