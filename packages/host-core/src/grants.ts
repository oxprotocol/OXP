/**
 * Phase A.4 — per-(publisher, slug) install-time permission grants.
 *
 * Persists the user's decision separately from `installed.json` so that:
 *   - a re-install (same publisher/slug, same or upgraded version) does
 *     not silently re-grant whatever the manifest now lists;
 *   - the host can detect *new* permissions on a version upgrade and
 *     re-prompt the user before activating;
 *   - uninstalling does NOT clear the grant — re-installing the same
 *     publisher/slug shows the user "you previously granted X, Y" so
 *     they recognise their prior decision and aren't tricked into
 *     re-granting silently. Use `Grants.clear()` for an explicit reset.
 *
 * On-disk shape (`<root>/grants.json`):
 *
 *   [
 *     {
 *       "publisher": "aldgar",
 *       "slug": "first-extension",
 *       "granted": ["fs.read:**", "net.fetch:api.github.com"],
 *       "decidedAt": "2026-05-04T12:34:56.000Z",
 *       "lastSeenVersion": "0.0.1",
 *       "lastSeenManifestPermissions": ["fs.read:**", "net.fetch:api.github.com"]
 *     }
 *   ]
 *
 * `lastSeenManifestPermissions` is recorded so that on a version
 * upgrade we can compute the *delta* against what the user was shown,
 * not against what they granted (the user may have customised down).
 */

import { Buffer } from "node:buffer";
import type { HostFs } from "./fs.js";

const GRANTS_FILE = "grants.json";

export interface PermissionGrant {
  publisher: string;
  slug: string;
  /**
   * The exact permission strings the user approved. Always a subset
   * of `lastSeenManifestPermissions`. Empty array means "approved
   * with zero capabilities" (i.e. ambient-only) — distinct from the
   * record being absent (= "never prompted yet").
   */
  granted: string[];
  /**
   * ISO-8601 timestamp of the last decision (initial grant or re-prompt).
   */
  decidedAt: string;
  /**
   * Version the user last saw a prompt for. Used as a tripwire — a
   * different installed version triggers diff-vs-`lastSeenManifestPermissions`.
   */
  lastSeenVersion: string;
  /**
   * The manifest's full permissions array at the time of the last prompt.
   * Used to detect newly-added permissions on a version upgrade.
   */
  lastSeenManifestPermissions: string[];
}

export class Grants {
  constructor(
    private readonly fs: HostFs,
    private readonly root: string,
  ) {}

  private filePath(): string {
    return this.fs.join(this.root, GRANTS_FILE);
  }

  async readAll(): Promise<PermissionGrant[]> {
    if (!(await this.fs.exists(this.filePath()))) return [];
    try {
      const bytes = await this.fs.readFile(this.filePath());
      const raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
      return Array.isArray(raw) ? (raw as PermissionGrant[]) : [];
    } catch {
      return [];
    }
  }

  private async writeAll(grants: PermissionGrant[]): Promise<void> {
    await this.fs.mkdirp(this.root);
    await this.fs.writeFile(
      this.filePath(),
      Buffer.from(JSON.stringify(grants, null, 2), "utf8"),
    );
  }

  /** Look up a grant for `(publisher, slug)`. Returns undefined if absent. */
  async get(
    publisher: string,
    slug: string,
  ): Promise<PermissionGrant | undefined> {
    const all = await this.readAll();
    return all.find((g) => g.publisher === publisher && g.slug === slug);
  }

  /**
   * Record (or replace) the grant for `(publisher, slug)`. Idempotent —
   * a second call with the same key overwrites the prior entry.
   */
  async set(grant: PermissionGrant): Promise<void> {
    const all = await this.readAll();
    const filtered = all.filter(
      (g) => !(g.publisher === grant.publisher && g.slug === grant.slug),
    );
    filtered.push(grant);
    await this.writeAll(filtered);
  }

  /** Drop the grant entirely. Returns true if a record was removed. */
  async clear(publisher: string, slug: string): Promise<boolean> {
    const all = await this.readAll();
    const next = all.filter(
      (g) => !(g.publisher === publisher && g.slug === slug),
    );
    if (next.length === all.length) return false;
    await this.writeAll(next);
    return true;
  }
}

/**
 * Compare two permission lists and return what is in `requested` but
 * not in `previouslyShown`. Used to decide whether a version upgrade
 * needs to re-prompt: if `addedPermissions(prev, req).length === 0`
 * the user has already seen everything in the new manifest.
 *
 * String comparison is exact — `"fs.read:/foo"` and `"fs.read:/bar"`
 * are different scopes and a new scope is treated as a new permission.
 */
export function addedPermissions(
  previouslyShown: readonly string[],
  requested: readonly string[],
): string[] {
  const seen = new Set(previouslyShown);
  return requested.filter((p) => !seen.has(p));
}
