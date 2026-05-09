-- Email verification + password reset tokens.
-- Additive: never drops or rewrites existing rows.

CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "tokenHash"  TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_tokenHash_key"
  ON "email_verification_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_userId_idx"
  ON "email_verification_tokens" ("userId");

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "tokenHash"  TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_key"
  ON "password_reset_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_userId_idx"
  ON "password_reset_tokens" ("userId");

-- Grandfather existing accounts: any user without emailVerified gets
-- credit for their joinedAt timestamp so today's signed-in users aren't
-- locked out of the new gate. Going forward, signup sets it null and
-- requires the verify step.
UPDATE "users" SET "emailVerified" = "joinedAt"
  WHERE "emailVerified" IS NULL;
