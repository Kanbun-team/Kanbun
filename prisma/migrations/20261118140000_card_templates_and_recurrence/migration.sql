-- CreateTable
CREATE TABLE "CardTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "tagIds" TEXT NOT NULL DEFAULT '[]',
    "checklist" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CardTemplate_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardRecurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "templateId" TEXT,
    "columnId" TEXT,
    "rule" TEXT NOT NULL,
    "weekday" INTEGER,
    "monthDay" INTEGER,
    "timeOfDay" TEXT,
    "nextRunAt" DATETIME NOT NULL,
    "lastRunAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardRecurrence_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardRecurrence_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CardTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CardRecurrence_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CardRecurrence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CardTemplate_boardId_name_idx" ON "CardTemplate"("boardId", "name");

-- CreateIndex
CREATE INDEX "CardRecurrence_active_nextRunAt_idx" ON "CardRecurrence"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "CardRecurrence_boardId_idx" ON "CardRecurrence"("boardId");

-- CreateIndex
CREATE INDEX "CardRecurrence_templateId_idx" ON "CardRecurrence"("templateId");

-- CreateIndex
CREATE INDEX "CardRecurrence_columnId_idx" ON "CardRecurrence"("columnId");

