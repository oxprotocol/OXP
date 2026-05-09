/**
 * `oxp://` deep-link parser.
 *
 * Supported forms:
 *
 *   oxp://install/@publisher/slug
 *   oxp://install/@publisher/slug?version=1.2.3
 *   oxp://install/@publisher/slug?version=1.2.3&host=vscode&host=cursor
 *
 * The web side (`apps/web`) emits these as the target of "Install"
 * buttons. The OS routes the URL to whichever app has registered the
 * `oxp` scheme — for us, the helper produced by `oxp protocol-register`,
 * which simply re-invokes `oxp install --from <url>`.
 *
 * Strict parsing on purpose: a bad URL fails fast rather than letting a
 * malformed click mutate the install store.
 */

export interface InstallUrl {
  kind: "install";
  id: string;
  version?: string;
  hosts?: string[];
}

export type ParsedOxpUrl = InstallUrl;

export class OxpUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OxpUrlError";
  }
}

const ID_RE = /^@[^/\s]+\/[^/\s?#]+$/;

export function parseOxpUrl(input: string): ParsedOxpUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OxpUrlError(`not a valid URL: ${input}`);
  }
  if (url.protocol !== "oxp:") {
    throw new OxpUrlError(`expected oxp:// scheme, got ${url.protocol}`);
  }

  // `new URL("oxp://install/@p/s")` parses host="install" and pathname="/@p/s".
  const action = url.host || url.hostname;
  if (action !== "install") {
    throw new OxpUrlError(`unknown action '${action}' (expected 'install')`);
  }

  // Strip leading slash; everything after is `@publisher/slug`.
  const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!ID_RE.test(id)) {
    throw new OxpUrlError(
      `bad extension id '${id}' — expected @publisher/slug`,
    );
  }

  const version = url.searchParams.get("version") ?? undefined;
  if (version && !/^[A-Za-z0-9.\-+]+$/.test(version)) {
    throw new OxpUrlError(`bad version '${version}'`);
  }

  const hosts = url.searchParams.getAll("host");
  for (const h of hosts) {
    if (!/^[a-z0-9-]+$/.test(h)) {
      throw new OxpUrlError(`bad host filter '${h}'`);
    }
  }

  return {
    kind: "install",
    id,
    version,
    hosts: hosts.length ? hosts : undefined,
  };
}

/** Build a canonical install URL — used by the web button helper. */
export function buildInstallUrl(
  id: string,
  opts: { version?: string; hosts?: string[] } = {},
): string {
  if (!ID_RE.test(id)) throw new OxpUrlError(`bad id ${id}`);
  const url = new URL(`oxp://install/${id}`);
  if (opts.version) url.searchParams.set("version", opts.version);
  for (const h of opts.hosts ?? []) url.searchParams.append("host", h);
  return url.toString();
}
