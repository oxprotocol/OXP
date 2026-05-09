/**
 * Public avatar GET — serves the bytes uploaded via /api/account/avatar.
 *
 * The URL is stable per user: `/api/avatars/<userId>`. Cache-busting is
 * handled by the `?v=<avatarUpdatedAt>` query string the UI appends.
 */

import { NextResponse } from "next/server";
import { getAvatar } from "@/lib/avatar-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const stored = await getAvatar(userId);
  if (!stored) {
    return new NextResponse("not found", { status: 404 });
  }
  // Cast Buffer -> Uint8Array (BodyInit-compatible) and copy into a fresh
  // ArrayBuffer view so the response body is independent of the read buffer.
  const body = new Uint8Array(stored.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": stored.contentType,
      "content-length": String(stored.bytes.byteLength),
      // Short-cache: clients append ?v=<timestamp> for cache-busting.
      "cache-control": "public, max-age=60, must-revalidate",
    },
  });
}
