/**
 * Filesystem-backed avatar store.
 *
 * Layout: <AVATAR_DIR>/<userId[0..2]>/<userId>.<ext>
 *
 * Avatars are bound to the userId, not content-addressed: a user can only
 * have one current avatar at a time. The MIME type is also persisted in
 * a sidecar `<userId>.mime` file so the GET route can serve the correct
 * Content-Type without needing to inspect bytes.
 *
 * Drop-in S3 swap: re-implement put/get/delete with the same signatures.
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";

let _root: string | null = null;

function avatarRoot(): string {
  if (_root) return _root;
  const fromEnv = process.env.OXP_AVATAR_DIR;
  if (!fromEnv) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "OXP_AVATAR_DIR is required in production — refusing to use a cwd-relative avatar root.",
      );
    }
    const fallback = join(process.cwd(), ".oxp-avatars");
    console.warn(
      `[avatar-store] OXP_AVATAR_DIR not set; using dev fallback ${fallback}`,
    );
    _root = resolve(fallback);
  } else {
    _root = resolve(fromEnv);
  }
  return _root;
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function pathFor(userId: string): { bin: string; mime: string } {
  if (!ID_RE.test(userId)) {
    throw new Error(`avatar: invalid userId: ${userId}`);
  }
  const dir = join(avatarRoot(), userId.slice(0, 2));
  return { bin: join(dir, `${userId}.bin`), mime: join(dir, `${userId}.mime`) };
}

export interface StoredAvatar {
  bytes: Buffer;
  contentType: string;
}

export async function putAvatar(
  userId: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { bin, mime } = pathFor(userId);
  await fs.mkdir(dirname(bin), { recursive: true });
  const tmp = `${bin}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, bytes, { mode: 0o644 });
  await fs.rename(tmp, bin);
  await fs.writeFile(mime, contentType, { mode: 0o644 });
}

export async function getAvatar(userId: string): Promise<StoredAvatar | null> {
  const { bin, mime } = pathFor(userId);
  try {
    const [bytes, mimeStr] = await Promise.all([
      fs.readFile(bin),
      fs.readFile(mime, "utf8").catch(() => "image/png"),
    ]);
    return { bytes, contentType: mimeStr.trim() || "image/png" };
  } catch {
    return null;
  }
}

export async function deleteAvatar(userId: string): Promise<void> {
  const { bin, mime } = pathFor(userId);
  await Promise.allSettled([fs.unlink(bin), fs.unlink(mime)]);
}
