"use server";

/**
 * Dashboard server actions for API token management.
 * Session-authenticated (NextAuth), unlike the bearer-authenticated
 * /api/v1/tokens/rotate endpoint used by the CLI.
 */

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { DEFAULT_TOKEN_TTL_DAYS, isValidScope } from "@/lib/token-scopes";
import { recordAudit } from "@/lib/audit";

export type CreateTokenResult =
  | { ok: true; token: string; tokenId: string }
  | { ok: false; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_TOKENS_PER_USER = 25;

export async function createToken(
  _prev: CreateTokenResult | undefined,
  formData: FormData,
): Promise<CreateTokenResult> {
  const me = await requireUser();

  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 200);
  if (!name) return { ok: false, error: "Token name is required." };

  const ttlRaw = String(formData.get("ttlDays") ?? "");
  const ttlDays = ttlRaw === "" ? DEFAULT_TOKEN_TTL_DAYS : Number(ttlRaw);
  if (!Number.isFinite(ttlDays) || ttlDays < 1 || ttlDays > 365) {
    return { ok: false, error: "Expiry must be between 1 and 365 days." };
  }

  const scopeMode = String(formData.get("scopeMode") ?? "namespace");
  let scopes: string[];
  if (scopeMode === "namespace") {
    scopes = [`publish:@${me.handle}/*`];
  } else if (scopeMode === "package") {
    const slug = String(formData.get("packageSlug") ?? "").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      return {
        ok: false,
        error: "Package slug must be lowercase letters, digits, and hyphens.",
      };
    }
    scopes = [`publish:@${me.handle}/${slug}`];
  } else if (scopeMode === "custom") {
    const raw = String(formData.get("customScopes") ?? "");
    scopes = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (scopes.length === 0) {
      return { ok: false, error: "Provide at least one scope." };
    }
    const bad = scopes.filter((s) => !isValidScope(s));
    if (bad.length > 0) {
      return { ok: false, error: `Invalid scope: ${bad.join(", ")}` };
    }
    // Refuse * / tokens:rotate from the dashboard — admin-only paths.
    const forbidden = scopes.filter((s) => s === "*" || s === "tokens:rotate");
    if (forbidden.length > 0) {
      return {
        ok: false,
        error: `Cannot mint admin scope from dashboard: ${forbidden.join(", ")}`,
      };
    }
    // Refuse cross-namespace publishes.
    const allowed = scopes.every((s) => {
      if (s === "publish" || s === "publish:*") return false;
      if (!s.startsWith(`publish:@${me.handle}`)) return false;
      return true;
    });
    if (!allowed) {
      return {
        ok: false,
        error: `Scopes must target your namespace (@${me.handle}).`,
      };
    }
  } else {
    return { ok: false, error: "Unknown scope mode." };
  }

  const count = await prisma.apiToken.count({ where: { userId: me.id } });
  if (count >= MAX_TOKENS_PER_USER) {
    return {
      ok: false,
      error: `You have reached the limit of ${MAX_TOKENS_PER_USER} tokens. Revoke one first.`,
    };
  }

  const raw = `oxp_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const created = await prisma.apiToken.create({
    data: {
      userId: me.id,
      name,
      tokenHash,
      scopes,
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    },
  });

  await recordAudit({
    action: "token.create",
    target: created.id,
    actorUserId: me.id,
    metadata: { name, scopes, ttlDays },
  });

  revalidatePath("/dashboard/tokens");
  return { ok: true, token: raw, tokenId: created.id };
}

export async function revokeToken(tokenId: string): Promise<ActionResult> {
  const me = await requireUser();
  if (typeof tokenId !== "string" || !tokenId) {
    return { ok: false, error: "Missing token id." };
  }

  // Only delete if this user owns it (defense in depth).
  const result = await prisma.apiToken.deleteMany({
    where: { id: tokenId, userId: me.id },
  });
  if (result.count === 0) {
    return { ok: false, error: "Token not found." };
  }
  await recordAudit({
    action: "token.revoke",
    target: tokenId,
    actorUserId: me.id,
  });
  revalidatePath("/dashboard/tokens");
  return { ok: true };
}
