/**
 * Find-or-provision a user from SSO assertion. If a User with the email
 * already exists, ensure they are a member of the org (auto-add as
 * `contributor` so they can sign in; admins can promote later). If not,
 * create the user with a random password (they'll only sign in via SSO),
 * generate an unused handle from the email local-part + numeric suffix.
 *
 * NOTE: this trusts the assertion's email claim. The caller must have
 * already verified the assertion signature.
 */

import { prisma } from "./prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { User } from "@prisma/client";

export interface SsoProvisionInput {
  orgId: string;
  email: string;
  displayName: string;
}

export async function findOrProvisionSsoUser(
  input: SsoProvisionInput,
): Promise<User> {
  const email = input.email.toLowerCase().trim();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const handle = await uniqueHandleFromEmail(email);
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    user = await prisma.user.create({
      data: {
        handle,
        email,
        passwordHash,
        displayName: input.displayName || email.split("@")[0],
        avatarSeed: handle,
        emailVerified: new Date(),
      },
    });
    await prisma.namespaceHandle.create({
      data: { handle, kind: "user", ownerId: user.id },
    });
  }
  // Ensure membership.
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: input.orgId, userId: user.id } },
    create: { orgId: input.orgId, userId: user.id, role: "contributor" },
    update: {},
  });
  return user;
}

async function uniqueHandleFromEmail(email: string): Promise<string> {
  const base =
    email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "user";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const taken = await prisma.namespaceHandle.findUnique({
      where: { handle: candidate },
    });
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}
