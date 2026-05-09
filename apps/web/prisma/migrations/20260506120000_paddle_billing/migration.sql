-- Add `enterprise` to the Plan enum.
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'enterprise';

-- Subscription: add Paddle Billing identifiers + cancellation + audit cols.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "paddleCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "paddleSubId"      TEXT,
  ADD COLUMN IF NOT EXISTS "paddlePriceId"    TEXT,
  ADD COLUMN IF NOT EXISTS "cancelAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_paddleCustomerId_key"
  ON "subscriptions" ("paddleCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_paddleSubId_key"
  ON "subscriptions" ("paddleSubId");
