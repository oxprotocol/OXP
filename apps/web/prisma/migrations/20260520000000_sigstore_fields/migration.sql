-- Phase B.5b — Sigstore keyless signature verification.
-- Adds columns to versions that store the verified Sigstore bundle plus
-- the OIDC identity / Rekor coordinates extracted from the Fulcio cert.
-- All columns are nullable: the Ed25519 signature remains the mandatory
-- layer; Sigstore is an optional, public-good co-signature.

ALTER TABLE "versions"
  ADD COLUMN IF NOT EXISTS "sigstoreBundle" JSONB,
  ADD COLUMN IF NOT EXISTS "rekorLogIndex"  TEXT,
  ADD COLUMN IF NOT EXISTS "signerIdentity" TEXT,
  ADD COLUMN IF NOT EXISTS "signerIssuer"   TEXT;
