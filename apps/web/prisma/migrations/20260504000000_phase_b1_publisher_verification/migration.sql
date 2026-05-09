-- CreateEnum
CREATE TYPE "PublisherVerificationMethod" AS ENUM ('dns_txt', 'github_oauth');

-- CreateEnum
CREATE TYPE "PublisherVerificationStatus" AS ENUM ('pending', 'verified', 'failed', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "publisher_verifications" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "method" "PublisherVerificationMethod" NOT NULL,
    "target" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "PublisherVerificationStatus" NOT NULL DEFAULT 'pending',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "publisher_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "publisher_verifications_token_key" ON "publisher_verifications"("token");

-- CreateIndex
CREATE INDEX "publisher_verifications_handle_status_idx" ON "publisher_verifications"("handle", "status");

-- CreateIndex
CREATE UNIQUE INDEX "publisher_verifications_handle_method_target_key" ON "publisher_verifications"("handle", "method", "target");
