-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "accessTasks" BOOLEAN NOT NULL DEFAULT true,
    "themePreference" TEXT NOT NULL DEFAULT 'system',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "Board_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoardMember" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("boardId", "userId"),
    CONSTRAINT "BoardMember_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoardColumn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "BoardColumn_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "columnId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "deadline" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "TaskCard_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoardTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoardTag_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCardTag" (
    "cardId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("cardId", "tagId"),
    CONSTRAINT "TaskCardTag_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCardTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "BoardTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "TaskBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskSubtask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "completedById" TEXT,
    CONSTRAINT "TaskSubtask_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskSubtask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCardAssignee" (
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    PRIMARY KEY ("cardId", "userId"),
    CONSTRAINT "TaskCardAssignee_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCardAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCardComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskCardComment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCardComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCardMoveEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "cardTitle" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fromColumnName" TEXT,
    "toColumnName" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskCardMoveEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'web',
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Board_createdById_idx" ON "Board"("createdById");

-- CreateIndex
CREATE INDEX "BoardMember_userId_idx" ON "BoardMember"("userId");

-- CreateIndex
CREATE INDEX "BoardColumn_boardId_position_idx" ON "BoardColumn"("boardId", "position");

-- CreateIndex
CREATE INDEX "TaskCard_columnId_position_idx" ON "TaskCard"("columnId", "position");

-- CreateIndex
CREATE INDEX "TaskCard_createdById_idx" ON "TaskCard"("createdById");

-- CreateIndex
CREATE INDEX "BoardTag_boardId_idx" ON "BoardTag"("boardId");

-- CreateIndex
CREATE INDEX "TaskCardTag_tagId_idx" ON "TaskCardTag"("tagId");

-- CreateIndex
CREATE INDEX "TaskBlock_blockedId_idx" ON "TaskBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskBlock_blockerId_blockedId_key" ON "TaskBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "TaskSubtask_cardId_position_idx" ON "TaskSubtask"("cardId", "position");

-- CreateIndex
CREATE INDEX "TaskCardAssignee_userId_idx" ON "TaskCardAssignee"("userId");

-- CreateIndex
CREATE INDEX "TaskCardComment_cardId_createdAt_idx" ON "TaskCardComment"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskCardComment_authorId_createdAt_idx" ON "TaskCardComment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskCardMoveEvent_boardId_createdAt_idx" ON "TaskCardMoveEvent"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskCardMoveEvent_userId_createdAt_idx" ON "TaskCardMoveEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserSession_userId_lastSeenAt_idx" ON "UserSession"("userId", "lastSeenAt");
