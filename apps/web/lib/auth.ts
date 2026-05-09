/**
 * Auth helpers — wraps NextAuth v5's `auth()` and Prisma so callers like
 * `getCurrentUser()` / `requireUser()` keep their original signatures.
 *
 * Server-only — never import from a client component.
 */

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { User } from "./types";

export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const row = await prisma.user.findUnique({ where: { id } });
  if (!row) return null;

  return toPublicUser(row);
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("AUTH_REQUIRED", "sign in required");
  return user;
}

/** Map a Prisma `User` row to the lib/types `User` (no passwordHash leakage). */
function toPublicUser(row: {
  id: string;
  handle: string;
  email: string;
  displayName: string;
  avatarSeed: string;
  avatarUrl?: string | null;
  avatarUpdatedAt?: Date | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  joinedAt: Date;
  subscriptionId: string | null;
  verificationLevel?: "unverified" | "github" | "domain";
  verifiedAt?: Date | null;
  githubLogin?: string | null;
}): User {
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    displayName: row.displayName,
    avatarSeed: row.avatarSeed,
    avatarUrl: row.avatarUrl ?? undefined,
    avatarUpdatedAt: row.avatarUpdatedAt
      ? row.avatarUpdatedAt.toISOString()
      : undefined,
    bio: row.bio ?? undefined,
    location: row.location ?? undefined,
    website: row.website ?? undefined,
    joinedAt: row.joinedAt.toISOString(),
    subscriptionId: row.subscriptionId ?? undefined,
    verificationLevel: row.verificationLevel ?? "unverified",
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : undefined,
    githubLogin: row.githubLogin ?? undefined,
  };
}
