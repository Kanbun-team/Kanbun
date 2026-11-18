-- Checklists 2.0: an assignee and a due date per checklist item. Added with
-- ALTER TABLE ADD COLUMN so TaskSubtask is not rebuilt.
ALTER TABLE "TaskSubtask" ADD COLUMN "assigneeId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskSubtask" ADD COLUMN "dueDate" DATETIME;

-- CreateIndex
CREATE INDEX "TaskSubtask_assigneeId_idx" ON "TaskSubtask"("assigneeId");

-- CreateTable
CREATE TABLE "CardAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardAttachment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CardAttachment_storageKey_key" ON "CardAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "CardAttachment_cardId_createdAt_idx" ON "CardAttachment"("cardId", "createdAt");
