"use server";

/**
 * Repo settings — server actions.
 *
 * These mutations are not yet implemented against Postgres. Until they are,
 * every action throws `AppError("NOT_IMPLEMENTED")` so the UI can surface a
 * clear "Coming soon" state instead of pretending the change succeeded. The
 * argument shapes are stable — when the Prisma-backed handlers land, only
 * the bodies below change.
 */

import { requireUser } from "@/lib/auth";
import { getExtension } from "@/lib/registry";
import { getExtensionDb } from "@/lib/registry-db";
import { AppError } from "@/lib/errors";

async function authoriseOwner(handle: string, slug: string) {
  const user = await requireUser();
  // Seed first (mock data), then DB (real published).
  const ext =
    getExtension(handle, slug) ??
    (await getExtensionDb(handle, slug).catch(() => null));
  if (!ext) throw new AppError("NOT_FOUND", `extension ${handle}/${slug}`);
  if (ext.ownerHandle !== user.handle)
    throw new AppError(
      "FORBIDDEN",
      `not the owner of ${ext.ownerHandle}/${ext.slug}`,
    );
  return ext;
}

export async function setVisibility(
  handle: string,
  slug: string,
  visibility: "public" | "private",
) {
  const ext = await authoriseOwner(handle, slug);
  throw new AppError(
    "NOT_IMPLEMENTED",
    `setVisibility is not yet wired to the database`,
    { details: { extensionId: ext.id, visibility } },
  );
}

export async function renameRepo(
  handle: string,
  slug: string,
  newSlug: string,
) {
  const ext = await authoriseOwner(handle, slug);
  throw new AppError(
    "NOT_IMPLEMENTED",
    `renameRepo is not yet wired to the database`,
    { details: { extensionId: ext.id, newSlug } },
  );
}

export async function transferOwnership(
  handle: string,
  slug: string,
  newOwnerHandle: string,
) {
  const ext = await authoriseOwner(handle, slug);
  throw new AppError(
    "NOT_IMPLEMENTED",
    `transferOwnership is not yet wired to the database`,
    { details: { extensionId: ext.id, newOwnerHandle } },
  );
}

export async function deleteRepo(
  handle: string,
  slug: string,
  confirmation: string,
) {
  const ext = await authoriseOwner(handle, slug);
  if (confirmation !== `${ext.ownerHandle}/${ext.slug}`) {
    throw new AppError(
      "CONFIRMATION_MISMATCH",
      `confirmation must equal "${ext.ownerHandle}/${ext.slug}"`,
    );
  }
  throw new AppError(
    "NOT_IMPLEMENTED",
    `deleteRepo is not yet wired to the database`,
    { details: { extensionId: ext.id } },
  );
}
