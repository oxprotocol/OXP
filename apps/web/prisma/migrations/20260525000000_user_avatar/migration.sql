-- User profile avatars.
-- Additive: optional columns, safe to apply on a populated table.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "avatarUpdatedAt" TIMESTAMP(3);
