/**
 * HostFs — minimal filesystem contract a host implements so @oxprotocol/host-core
 * can install/uninstall/read extensions without depending on Node `fs`,
 * the `vscode` module, Piye's compositor FS, or anything else.
 *
 * Paths are opaque strings to host-core. Hosts decide their own URI scheme
 * (file://, vscode-userdata://, piye-vfs://) and how to join segments.
 */

export interface HostFs {
  /** True if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;

  /** Recursively create the directory. Idempotent. */
  mkdirp(path: string): Promise<void>;

  /** Read entire file as bytes. Throws if missing. */
  readFile(path: string): Promise<Uint8Array>;

  /** Write entire file. Creates parent dirs as needed. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;

  /** Recursively delete path. No-op if missing. */
  rm(path: string): Promise<void>;

  /**
   * Join path segments using whatever separator the underlying host expects.
   * Implementations must return a single absolute path.
   */
  join(...segments: string[]): string;
}
