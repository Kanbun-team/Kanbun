-- CreateTable
CREATE TABLE "BoardCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AlterTable: add nullable categoryId with FK to BoardCategory
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    "categoryId" TEXT,
    CONSTRAINT "Board_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Board_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BoardCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Board" ("id", "name", "description", "color", "archived", "createdAt", "updatedAt", "createdById")
SELECT "id", "name", "description", "color", "archived", "createdAt", "updatedAt", "createdById" FROM "Board";

DROP TABLE "Board";
ALTER TABLE "new_Board" RENAME TO "Board";

CREATE INDEX "Board_createdById_idx" ON "Board"("createdById");
CREATE INDEX "Board_categoryId_idx" ON "Board"("categoryId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
