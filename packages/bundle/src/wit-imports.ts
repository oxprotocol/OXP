/**
 * Phase A.4 — extract `oxp:host/<interface>` imports from a Wasm component.
 *
 * **Why this exists.** The roadmap requires the install-time prompt to
 * read the *component's actual WIT imports*, not just the manifest's
 * `permissions` array. Otherwise a malicious publisher could omit
 * permissions from the manifest while the binary still imports the
 * interface — and any code path that derives the prompt from the
 * manifest alone would silently grant nothing while the broker rejects
 * every call at runtime (a confusing failure mode), OR worse, the
 * prompt UI would lie about what the extension can do.
 *
 * **Implementation.** Proper WIT import parsing requires a full
 * component-model decoder (see wasm-tools / wit-component). Pulling
 * that into host-core would balloon dependencies and is overkill for
 * what we actually need: the names of the `oxp:host/*` interfaces a
 * component imports. The component model encodes import names as
 * length-prefixed UTF-8 strings inside the component's `import`
 * section, and the strings appear nowhere else in a well-formed
 * component (the strings are not stored in the type section, only
 * referenced by index). So a byte-level scan for the literal pattern
 * `oxp:host/<id>@<version>` is reliable in practice for our universe
 * of 8 interfaces.
 *
 * **Limitations.**
 *   - This is a heuristic extractor, not a parser. It cannot
 *     distinguish import vs export sections (both encode the name as
 *     UTF-8). Today every `oxp:host/*` reference IS an import (the
 *     extension never exports them) so this is fine. If we ever ship
 *     extensions that re-export host interfaces this needs replacing
 *     with a real component-model parser.
 *   - Returns interface names without the `@version` suffix. A
 *     component pinning to `oxp:host/fs@0.2.0` will be reported as
 *     `oxp:host/fs`. Version pinning is enforced separately by the
 *     WIT pin (Phase A.11).
 *
 * The companion table `WIT_INTERFACE_REQUIREMENTS` declares which
 * manifest permissions each interface requires. Used by both the
 * server-side publish gate and the host-side install gate.
 */

import type { Capability } from "@oxprotocol/types";

const HOST_PACKAGE = "oxp:host/";
const KNOWN_INTERFACES = [
  "types",
  "log",
  "storage",
  "ui",
  "fs",
  "net",
  "secrets",
  "commands",
] as const;

export type HostInterface = (typeof KNOWN_INTERFACES)[number];

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_INTERFACES);

/**
 * Map from `oxp:host/<interface>` → the set of capabilities a manifest
 * must grant for the interface to be importable.
 *
 *   - `requires`: the manifest must include AT LEAST ONE of these
 *     capability ids (bare or scoped). Empty array means the interface
 *     is *ambient* — always available, no permission needed.
 *
 * Sourced from `packages/wit/wit/oxp-host.wit` interface comments.
 */
export const WIT_INTERFACE_REQUIREMENTS: Readonly<
  Record<HostInterface, { requires: readonly Capability[] }>
> = {
  types: { requires: [] },
  log: { requires: [] },
  storage: { requires: [] },
  ui: { requires: [] },
  fs: { requires: ["fs.read", "fs.write", "fs.delete", "fs.watch"] },
  net: { requires: ["net.fetch"] },
  secrets: { requires: ["secrets.read", "secrets.write"] },
  commands: { requires: ["commands.executeHost"] },
};

/**
 * Extract the set of `oxp:host/<interface>` names a component imports.
 * Returns an empty set if the bytes are not a Wasm binary or contain
 * no recognised host imports.
 *
 * The match is anchored to the literal package prefix so unrelated
 * UTF-8 bytes that happen to spell `fs` or `net` cannot trigger a
 * false positive.
 */
export function extractHostImports(bytes: Uint8Array): Set<HostInterface> {
  const found = new Set<HostInterface>();

  // Cheap upfront sanity check: Wasm magic + version.
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    return found;
  }

  // Decode the whole buffer as UTF-8 once. Embedded NULs and other
  // non-text bytes decode to the replacement char and break the prefix
  // match harmlessly. For our 50KB–500KB components this is cheap.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  let from = 0;
  while (true) {
    const at = text.indexOf(HOST_PACKAGE, from);
    if (at === -1) break;
    const start = at + HOST_PACKAGE.length;
    // Read until the next non-identifier char (interface names are
    // [a-z][a-z0-9-]*; we stop at anything else — `@`, NUL, brace, etc.).
    let end = start;
    while (end < text.length) {
      const ch = text.charCodeAt(end);
      const isLower = ch >= 0x61 && ch <= 0x7a; // a-z
      const isDigit = ch >= 0x30 && ch <= 0x39; // 0-9
      const isDash = ch === 0x2d; // -
      if (!isLower && !isDigit && !isDash) break;
      end++;
    }
    const name = text.slice(start, end);
    if (KNOWN_SET.has(name)) {
      found.add(name as HostInterface);
    }
    from = end;
  }

  return found;
}

/**
 * Validate that `manifest.permissions` covers every host interface the
 * component imports. Returns the list of *missing* interface→capability
 * gaps; empty array means the manifest is sufficient.
 *
 * Each gap names the interface and the set of capabilities the
 * manifest could declare to satisfy it (the user only needs ONE of
 * them, since the WIT interface is a single import either way).
 */
export interface PermissionGap {
  interface: HostInterface;
  /** One of these capabilities (bare or scoped) must appear in `permissions`. */
  oneOf: readonly Capability[];
}

export function findMissingPermissions(
  imports: Iterable<HostInterface>,
  permissions: readonly string[],
): PermissionGap[] {
  const declared = new Set<Capability>();
  for (const raw of permissions) {
    const head = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
    declared.add(head as Capability);
  }

  const gaps: PermissionGap[] = [];
  for (const iface of imports) {
    const req = WIT_INTERFACE_REQUIREMENTS[iface];
    if (!req || req.requires.length === 0) continue;
    const satisfied = req.requires.some((cap) => declared.has(cap));
    if (!satisfied) {
      gaps.push({ interface: iface, oneOf: req.requires });
    }
  }
  return gaps;
}
