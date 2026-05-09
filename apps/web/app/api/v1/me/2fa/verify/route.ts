import { NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";
import { confirmEnrollment } from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth.ok)
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );

  let body: { secret?: string; recoveryCodes?: string[]; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body must be JSON" },
      { status: 400 },
    );
  }
  if (
    typeof body.secret !== "string" ||
    !Array.isArray(body.recoveryCodes) ||
    body.recoveryCodes.length === 0 ||
    typeof body.code !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "secret, recoveryCodes, and code are required" },
      { status: 400 },
    );
  }
  const result = await confirmEnrollment({
    userId: auth.auth.user.id,
    secret: body.secret,
    token: body.code,
    recoveryCodes: body.recoveryCodes.map((c) => String(c)),
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason ?? "verification failed" },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true });
}
