-- Phase team-collab: invitations to join an org by email.
CREATE TABLE IF NOT EXISTS "org_invites" (
  "id"           TEXT PRIMARY KEY,
  "orgId"        TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "role"         "OrgRole" NOT NULL DEFAULT 'contributor',
  "tokenHash"    TEXT NOT NULL,
  "invitedById"  TEXT NOT NULL,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "acceptedAt"   TIMESTAMP(3),
  "acceptedById" TEXT,
  "revokedAt"    TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_invites_tokenHash_key" ON "org_invites"("tokenHash");
CREATE INDEX IF NOT EXISTS "org_invites_orgId_idx" ON "org_invites"("orgId");
CREATE INDEX IF NOT EXISTS "org_invites_email_idx" ON "org_invites"("email");
