-- AlterTable
ALTER TABLE "User" ADD COLUMN "deactivatedAt" DATETIME;

-- CreateTable
CREATE TABLE "TrashItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "deletedById" TEXT,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "categoryId" TEXT,
    CONSTRAINT "Board_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Board_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BoardCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Board" ("archived", "categoryId", "color", "createdAt", "createdById", "description", "id", "name", "position", "updatedAt") SELECT "archived", "categoryId", "color", "createdAt", "createdById", "description", "id", "name", "position", "updatedAt" FROM "Board";
DROP TABLE "Board";
ALTER TABLE "new_Board" RENAME TO "Board";
CREATE INDEX "Board_createdById_idx" ON "Board"("createdById");
CREATE INDEX "Board_categoryId_position_idx" ON "Board"("categoryId", "position");
CREATE TABLE "new_TaskBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "TaskBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskBlock" ("blockedId", "blockerId", "createdAt", "createdById", "id") SELECT "blockedId", "blockerId", "createdAt", "createdById", "id" FROM "TaskBlock";
DROP TABLE "TaskBlock";
ALTER TABLE "new_TaskBlock" RENAME TO "TaskBlock";
CREATE INDEX "TaskBlock_blockedId_idx" ON "TaskBlock"("blockedId");
CREATE UNIQUE INDEX "TaskBlock_blockerId_blockedId_key" ON "TaskBlock"("blockerId", "blockedId");
CREATE TABLE "new_TaskCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "columnId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "coverColor" TEXT,
    "deadline" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "TaskCard_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskCard" ("columnId", "coverColor", "createdAt", "createdById", "deadline", "description", "id", "position", "priority", "title", "updatedAt") SELECT "columnId", "coverColor", "createdAt", "createdById", "deadline", "description", "id", "position", "priority", "title", "updatedAt" FROM "TaskCard";
DROP TABLE "TaskCard";
ALTER TABLE "new_TaskCard" RENAME TO "TaskCard";
CREATE INDEX "TaskCard_columnId_position_idx" ON "TaskCard"("columnId", "position");
CREATE INDEX "TaskCard_createdById_idx" ON "TaskCard"("createdById");
CREATE TABLE "new_TaskCardComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskCardComment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCardComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskCardComment" ("authorId", "body", "cardId", "createdAt", "id", "updatedAt") SELECT "authorId", "body", "cardId", "createdAt", "id", "updatedAt" FROM "TaskCardComment";
DROP TABLE "TaskCardComment";
ALTER TABLE "new_TaskCardComment" RENAME TO "TaskCardComment";
CREATE INDEX "TaskCardComment_cardId_createdAt_idx" ON "TaskCardComment"("cardId", "createdAt");
CREATE INDEX "TaskCardComment_authorId_createdAt_idx" ON "TaskCardComment"("authorId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TrashItem_boardId_deletedAt_idx" ON "TrashItem"("boardId", "deletedAt");

-- CreateIndex
CREATE INDEX "TrashItem_deletedAt_idx" ON "TrashItem"("deletedAt");
