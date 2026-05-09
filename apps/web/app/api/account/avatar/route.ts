/**
 * Authenticated avatar upload / delete.
 *
 *   POST   multipart/form-data with field `file` (≤ 2 MB, image/png|jpeg|webp|gif)
 *   DELETE removes the current avatar
 *
 * Validation is byte-level (magic-number sniff) rather than trusting the
 * client-provided `Content-Type`. Stored URL is returned so the caller can
 * update its UI immediately; the URL is also persisted on the user row.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { putAvatar, deleteAvatar } from "@/lib/avatar-store";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB

/** Magic-number sniff for the image formats we accept. */
function detectImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38)
    return "image/gif";
  // WEBP: "RIFF....WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return null;
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = detectImage(bytes);
  if (!detected) {
    return NextResponse.json(
      { error: "unsupported image type (png, jpeg, webp, gif only)" },
      { status: 415 },
    );
  }

  await putAvatar(userId, bytes, detected);
  const now = new Date();
  const url = `/api/avatars/${userId}`;
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: url, avatarUpdatedAt: now },
  });

  return NextResponse.json({
    ok: true,
    avatarUrl: url,
    avatarUpdatedAt: now.toISOString(),
  });
}

export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  await deleteAvatar(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null, avatarUpdatedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
