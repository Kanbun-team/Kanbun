-- Webhook deliveries become a durable outbox: pending rows hold the body to
-- send and when it is due. Existing rows are finished deliveries.

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "payload" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';
UPDATE "WebhookDelivery" SET "status" = CASE WHEN "success" THEN 'success' ELSE 'failed' END;

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
