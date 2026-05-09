-- Phase 1 — CDN bandwidth metering
CREATE TABLE "bandwidth_usage" (
    "id" TEXT NOT NULL,
    "subjectKind" "AccountKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "bytesServed" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bandwidth_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bandwidth_usage_subjectKind_subjectId_yearMonth_key"
    ON "bandwidth_usage"("subjectKind", "subjectId", "yearMonth");

CREATE INDEX "bandwidth_usage_subjectId_idx"
    ON "bandwidth_usage"("subjectId");
