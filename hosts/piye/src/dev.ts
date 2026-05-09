/**
 * Piye host dev client.
 *
 * Connects to an `oxp dev` server, hot-reloads the mounted extension on
 * every rebuild without going through the Store. Reuses mount() from
 * mount.ts — the only difference is the bundle source and a forced
 * "DEV: signature bypass" badge in render output.
 *
 * Production hosts MUST refuse to call this unless dev mode is explicitly
 * enabled by the user.
 */
import WebSocket from "ws";
import { decodeDevReload, type InstalledRecord } from "@oxprotocol/host-core";
import { mount, type MountOptions, type MountedExtension } from "./mount.js";
import type { Store } from "@oxprotocol/host-core";

export interface DevAttachOptions extends MountOptions {
  /** http(s) URL of `oxp dev`, e.g. "http://localhost:7373". */
  devUrl: string;
  /** Required for store API parity, but the dev path never persists. */
  store: Store;
  /** Optional callback when a new mount happens (so PIYE-IDE can flash UI). */
  onReload?: (record: InstalledRecord) => void;
  /** Optional connection-state hook for showing the dev badge. */
  onStatus?: (status: "connecting" | "connected" | "error" | "closed") => void;
}

export interface DevAttachment {
  /** Currently mounted extension (null until first reload arrives). */
  current: MountedExtension | null;
  close(): Promise<void>;
}

export function attachDev(opts: DevAttachOptions): DevAttachment {
  const { devUrl, store, onReload, onStatus, ...mountOpts } = opts;
  const wsUrl = devUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/dev";

  const attachment: DevAttachment = {
    current: null,
    async close() {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      if (attachment.current) {
        await attachment.current.unmount();
        attachment.current = null;
      }
    },
  };

  onStatus?.("connecting");
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => onStatus?.("connected"));
  ws.on("error", () => onStatus?.("error"));
  ws.on("close", () => onStatus?.("closed"));

  ws.on("message", async (raw) => {
    let msg: { kind: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw.toString()) as typeof msg;
    } catch {
      return;
    }
    if (msg.kind !== "reload") return;

    const verified = await decodeDevReload(
      msg as unknown as Parameters<typeof decodeDevReload>[0],
    );

    // Synthetic InstalledRecord — never written to the Store.
    const record: InstalledRecord = {
      id: verified.id,
      version: verified.version,
      publisher: verified.publisher,
      slug: verified.slug,
      keyId: verified.keyId, // "dev:unsigned"
      tarSha256: verified.tarSha256,
      manifest: verified.manifest,
      installedAt: new Date().toISOString(),
      files: Array.from(verified.files.keys()),
    };

    if (attachment.current) {
      await attachment.current.unmount();
      attachment.current = null;
    }

    attachment.current = await mount(store, record, verified.files, mountOpts);
    onReload?.(record);
  });

  return attachment;
}
