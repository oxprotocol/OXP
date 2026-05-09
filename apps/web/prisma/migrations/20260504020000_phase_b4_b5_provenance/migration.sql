-- Phase B.4 / B.5 — provenance + attestation columns on versions.
ALTER TABLE "versions"
  ADD COLUMN "provenanceJson" JSONB,
  ADD COLUMN "attestationJson" JSONB;
