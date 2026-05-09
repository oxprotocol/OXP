import { Buffer } from "node:buffer";
import * as path from "node:path";
import type { HostFs } from "./fs.js";
import {
  type InstalledRecord,
  type VerifiedBundle,
  VerifyError,
} from "./types.js";

const INDEX_FILE = "installed.json";
const TRUST_FILE = "trust.json";
const EXT_DIR = "extensions";

/**
 * On-disk record of "this publisher's first-seen signing key".
 * Phase A.7 — Trust-On-First-Use (TOFU) pubkey pinning. After the first
 * install of @publisher/anything, all subsequent installs from that
 * publisher MUST present the same keyId, or the install is refused with
 * KEY_PINNING_VIOLATION. Users can override by manually deleting the
 * trust.json entry (audit trail visible).
 */
export interface PinnedKey {
  publisher: string;
  keyId: string;
  firstSeenAt: string;
  /** id where we first saw this key, for diagnostics. */
  viaExtensionId: string;
}

/**
 * Generic install index + on-disk layout. Does not assume Node, VS Code, or
 * Piye — talks to a HostFs implementation. Same code path runs everywhere.
 *
 * Layout under root/:
 *   installed.json
 *   extensions/<publisher>/<slug>/<version>/<files...>
 */
export class Store {
  constructor(
    private readonly fs: HostFs,
    private readonly root: string,
  ) {}

  private indexPath(): string {
    return this.fs.join(this.root, INDEX_FILE);
  }

  private trustPath(): string {
    return this.fs.join(this.root, TRUST_FILE);
  }

  private extDir(publisher: string, slug: string, version: string): string {
    return this.fs.join(this.root, EXT_DIR, publisher, slug, version);
  }

  /** Absolute path to an installed extension's root directory. */
  resourcePath(record: InstalledRecord): string {
    return this.extDir(record.publisher, record.slug, record.version);
  }

  async readIndex(): Promise<InstalledRecord[]> {
    if (!(await this.fs.exists(this.indexPath()))) return [];
    try {
      const bytes = await this.fs.readFile(this.indexPath());
      return JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      return [];
    }
  }

  private async writeIndex(records: InstalledRecord[]): Promise<void> {
    await this.fs.mkdirp(this.root);
    await this.fs.writeFile(
      this.indexPath(),
      Buffer.from(JSON.stringify(records, null, 2), "utf8"),
    );
  }

  /** Read the TOFU trust store (publisher → pinned keyId). */
  async readTrust(): Promise<PinnedKey[]> {
    if (!(await this.fs.exists(this.trustPath()))) return [];
    try {
      const bytes = await this.fs.readFile(this.trustPath());
      return JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      return [];
    }
  }

  private async writeTrust(pins: PinnedKey[]): Promise<void> {
    await this.fs.mkdirp(this.root);
    await this.fs.writeFile(
      this.trustPath(),
      Buffer.from(JSON.stringify(pins, null, 2), "utf8"),
    );
  }

  /**
   * Phase A.7 enforcement. Returns the existing pin if any. If the bundle's
   * keyId differs from a prior pin, throws KEY_PINNING_VIOLATION. If no pin
   * exists, records a new one (TOFU).
   */
  private async enforcePinning(verified: VerifiedBundle): Promise<void> {
    const pins = await this.readTrust();
    const existing = pins.find((p) => p.publisher === verified.publisher);
    if (existing) {
      if (existing.keyId !== verified.keyId) {
        throw new VerifyError(
          `publisher @${verified.publisher} is pinned to key ${existing.keyId} ` +
            `(first seen ${existing.firstSeenAt} via ${existing.viaExtensionId}), ` +
            `but ${verified.id}@${verified.version} is signed by ${verified.keyId}. ` +
            `Possible publisher account compromise. To override, manually delete ` +
            `the entry from ${this.trustPath()}.`,
          "KEY_PINNING_VIOLATION",
        );
      }
      return;
    }
    pins.push({
      publisher: verified.publisher,
      keyId: verified.keyId,
      firstSeenAt: new Date().toISOString(),
      viaExtensionId: verified.id,
    });
    await this.writeTrust(pins);
  }

  /**
   * Persist a verified bundle to disk and update the index.
   * Replaces any prior install of the same exact (publisher, slug, version).
   *
   * `opts.grantedPermissions` records the user's install-time decision
   * (Phase A.4). Pass `undefined` only from legacy code paths that
   * predate the consent flow — the activator will refuse to start
   * such records.
   */
  async install(
    verified: VerifiedBundle,
    opts: { grantedPermissions?: readonly string[] } = {},
  ): Promise<InstalledRecord> {
    // Phase A.7 — TOFU publisher key pinning. Fails closed before any
    // disk writes so a key-rotation attempt cannot leave partial state.
    await this.enforcePinning(verified);

    const dir = this.extDir(
      verified.publisher,
      verified.slug,
      verified.version,
    );

    if (await this.fs.exists(dir)) {
      await this.fs.rm(dir);
    }
    await this.fs.mkdirp(dir);

    const written: string[] = [];
    for (const [name, bytes] of verified.files) {
      const normalized = path.posix.normalize(name);
      if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
        throw new VerifyError(
          `refusing to write unsafe path: ${name}`,
          "UNSAFE_PATH",
        );
      }
      const filePath = this.fs.join(dir, ...normalized.split("/"));
      await this.fs.writeFile(filePath, bytes);
      written.push(normalized);
    }

    const index = await this.readIndex();
    const filtered = index.filter((r) => r.id !== verified.id);
    const record: InstalledRecord = {
      id: verified.id,
      version: verified.version,
      publisher: verified.publisher,
      slug: verified.slug,
      installedAt: new Date().toISOString(),
      keyId: verified.keyId,
      tarSha256: verified.tarSha256,
      manifest: verified.manifest,
      files: written,
      grantedPermissions: opts.grantedPermissions
        ? [...opts.grantedPermissions]
        : undefined,
    };
    filtered.push(record);
    await this.writeIndex(filtered);
    return record;
  }

  async uninstall(id: string): Promise<boolean> {
    const index = await this.readIndex();
    const target = index.find((r) => r.id === id);
    if (!target) return false;
    const dir = this.extDir(target.publisher, target.slug, target.version);
    if (await this.fs.exists(dir)) await this.fs.rm(dir);
    await this.writeIndex(index.filter((r) => r.id !== id));
    return true;
  }

  async get(id: string): Promise<InstalledRecord | undefined> {
    const index = await this.readIndex();
    return index.find((r) => r.id === id);
  }

  async list(): Promise<InstalledRecord[]> {
    return this.readIndex();
  }
}
