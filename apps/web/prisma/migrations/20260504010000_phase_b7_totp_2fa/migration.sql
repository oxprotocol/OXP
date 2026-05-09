-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpEnrolledAt" TIMESTAMP(3),
  ADD COLUMN "recoveryCodesHash" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "api_tokens" ADD COLUMN "lastTwoFactorAt" TIMESTAMP(3);
