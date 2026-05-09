import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { HostFs } from "@oxprotocol/host-core";

/**
 * Node FS adapter for HostFs. Used by the Piye main process to install
 * extensions to disk under e.g. ~/Library/Application Support/Piye/oxp/.
 *
 * Worker processes do NOT use this — they receive bundle files in-memory
 * via the BootMessage so they cannot touch disk directly.
 */
export function nodeHostFs(): HostFs {
  return {
    async exists(p: string): Promise<boolean> {
      try {
        await fs.stat(p);
        return true;
      } catch {
        return false;
      }
    },
    async mkdirp(p: string): Promise<void> {
      await fs.mkdir(p, { recursive: true });
    },
    async readFile(p: string): Promise<Uint8Array> {
      return await fs.readFile(p);
    },
    async writeFile(p: string, bytes: Uint8Array): Promise<void> {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, bytes);
    },
    async rm(p: string): Promise<void> {
      await fs.rm(p, { recursive: true, force: true });
    },
    join(...segments: string[]): string {
      return path.join(...segments);
    },
  };
}
