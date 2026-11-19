-- AlterTable
ALTER TABLE "TaskCardComment" ADD COLUMN     "clientKey" TEXT;
-- CreateIndex
CREATE UNIQUE INDEX "TaskCardComment_cardId_clientKey_key" ON "TaskCardComment"("cardId", "clientKey");
