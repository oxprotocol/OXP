"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { getUserPlan } from "@/lib/billing";

export interface CreateExtensionInput {
  name: string;
  slug: string;
  description: string;
  visibility: "public" | "private";
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Reserves an Extension row owned by the signed-in user. The bundle still
 * ships via `oxp publish` from the CLI; this just claims the (ownerHandle,
 * slug) pair so nobody else can.
 */
export async function createExtension(input: CreateExtensionInput) {
  const user = await requireUser();
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const description = input.description.trim();

  if (!name) throw new AppError("VALIDATION_FAILED", "name is required");
  if (!SLUG_RE.test(slug))
    throw new AppError(
      "VALIDATION_FAILED",
      "slug must be lowercase letters, digits, or hyphens (1-64 chars)",
    );
  let visibility: "public" | "private" = "public";
  if (input.visibility === "private") {
    const { plan } = await getUserPlan(user.id);
    if (plan === "free") {
      throw new AppError(
        "FORBIDDEN",
        "Private extensions require a Pro plan. Upgrade at /pricing.",
      );
    }
    visibility = "private";
  }

  const existing = await prisma.extension.findUnique({
    where: { ownerHandle_slug: { ownerHandle: user.handle, slug } },
  });
  if (existing)
    throw new AppError("CONFLICT", `@${user.handle}/${slug} already exists.`);

  await prisma.extension.create({
    data: {
      ownerHandle: user.handle,
      ownerKind: "user",
      ownerId: user.id,
      slug,
      title: name,
      description: description || `${name} — published via OXP.`,
      visibility,
      status: "active",
      availability: "planned",
      tags: [],
      latestVersion: null,
      downloads: BigInt(0),
      stars: 0,
    },
  });

  redirect(`/${user.handle}/${slug}`);
}
