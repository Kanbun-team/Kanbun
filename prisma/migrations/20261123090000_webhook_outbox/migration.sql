-- Webhook deliveries become a durable outbox: pending rows hold the body to
-- send and when it is due. Existing rows are finished deliveries.
ALTER TABLE "WebhookDelivery" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "WebhookDelivery" ADD COLUMN "payload" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "nextAttemptAt" DATETIME;
UPDATE "WebhookDelivery" SET "status" = CASE WHEN "success" THEN 'success' ELSE 'failed' END;

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
