-- Phase B.8 — Publisher verification level (denormalized) +
-- reserved-namespace manual-review flag + GitHub identity linkage on User.
--
-- Source of truth for the level remains `publisher_verifications`; these
-- columns are kept in sync by application code (`recomputePublisherLevel`)
-- so the directory can render badges without an N+1 lookup.

-- CreateEnum
CREATE TYPE "VerificationLevel" AS ENUM ('unverified', 'github', 'domain');

-- AlterTable: User
ALTER TABLE "users"
  ADD COLUMN "verificationLevel" "VerificationLevel" NOT NULL DEFAULT 'unverified',
  ADD COLUMN "verifiedAt"        TIMESTAMP(3),
  ADD COLUMN "githubLogin"       TEXT,
  ADD COLUMN "githubId"          TEXT;

CREATE UNIQUE INDEX "users_githubId_key" ON "users"("githubId");

-- AlterTable: Organization
ALTER TABLE "organizations"
  ADD COLUMN "verificationLevel" "VerificationLevel" NOT NULL DEFAULT 'unverified',
  ADD COLUMN "verifiedAt"        TIMESTAMP(3);

-- Backfill orgs that were already manually flagged as verified.
UPDATE "organizations" SET "verificationLevel" = 'domain', "verifiedAt" = NOW()
  WHERE "verified" = TRUE;

-- AlterTable: NamespaceHandle
ALTER TABLE "namespace_handles"
  ADD COLUMN "requiresManualReview" BOOLEAN NOT NULL DEFAULT FALSE;

-- Reserved + manual-review for OXP-internal handles seeded by the app.
UPDATE "namespace_handles" SET "requiresManualReview" = TRUE WHERE "reserved" = TRUE;
