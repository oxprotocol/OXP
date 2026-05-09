import { decompress } from "@mongodb-js/zstd";

/** Decompress an `.oxp` bundle (zstd) to its raw tar bytes. */
export async function decompressBundle(oxp: Buffer): Promise<Buffer> {
  return Buffer.from(await decompress(oxp));
}
