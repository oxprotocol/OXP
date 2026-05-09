import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton — avoids exhausting Mongo connections in dev / on hot reload.
 */
declare global {
  // eslint-disable-next-line no-var
  var __oxp_prisma__: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__oxp_prisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__oxp_prisma__ = prisma;
}
