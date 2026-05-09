-- Phase 2 — Audit logs: extend the existing audit_events table with
-- org scope, IP, and user-agent snapshot columns, plus indexes for
-- the org admin viewer and per-action queries.

ALTER TABLE "audit_events"
  ADD COLUMN IF NOT EXISTS "orgId" TEXT,
  ADD COLUMN IF NOT EXISTS "ip" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

CREATE INDEX IF NOT EXISTS "audit_events_orgId_createdAt_idx"
  ON "audit_events"("orgId", "createdAt");

CREATE INDEX IF NOT EXISTS "audit_events_action_createdAt_idx"
  ON "audit_events"("action", "createdAt");
