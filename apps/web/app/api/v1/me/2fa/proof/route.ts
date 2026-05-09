import { NextResponse } from "next/server";
import { authenticateBearer } from "@/lib/api-auth";
import { provideProof } from "@/lib/two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateBearer(req);
  if (!auth.ok)
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body must be JSON" },
      { status: 400 },
    );
  }
  if (typeof body.code !== "string" || !body.code.trim()) {
    return NextResponse.json(
      { ok: false, error: "code is required" },
      { status: 400 },
    );
  }
  const result = await provideProof({
    userId: auth.auth.user.id,
    tokenId: auth.auth.token.id,
    code: body.code,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason ?? "invalid code" },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    usedRecoveryCode: !!result.usedRecoveryCode,
  });
}
