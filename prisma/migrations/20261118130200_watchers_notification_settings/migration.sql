-- Watchers, notification preferences, email and daily digest.
-- Additive only: new tables and nullable or defaulted columns on User.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "notificationPrefs" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "digestSentAt" DATETIME;

-- CreateTable
CREATE TABLE "CardWatcher" (
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("cardId", "userId"),
    CONSTRAINT "CardWatcher_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoardWatcher" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("boardId", "userId"),
    CONSTRAINT "BoardWatcher_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoardWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DueSoonNotice" (
    "cardId" TEXT NOT NULL PRIMARY KEY,
    "deadline" DATETIME NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CardWatcher_userId_idx" ON "CardWatcher"("userId");

-- CreateIndex
CREATE INDEX "BoardWatcher_userId_idx" ON "BoardWatcher"("userId");
