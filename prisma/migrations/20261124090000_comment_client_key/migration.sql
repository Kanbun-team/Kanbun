-- Comments carry an optional key chosen by the client, so a retried send
-- returns the existing comment instead of creating a duplicate.
ALTER TABLE "TaskCardComment" ADD COLUMN "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TaskCardComment_cardId_clientKey_key" ON "TaskCardComment"("cardId", "clientKey");
