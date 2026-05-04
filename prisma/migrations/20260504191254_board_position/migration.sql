-- AlterTable
ALTER TABLE "Board" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill positions per category bucket so existing boards get a stable order
UPDATE "Board" SET "position" = (
  SELECT COUNT(*) FROM "Board" AS b2
  WHERE COALESCE(b2."categoryId", '') = COALESCE("Board"."categoryId", '')
    AND (b2."createdAt" < "Board"."createdAt"
      OR (b2."createdAt" = "Board"."createdAt" AND b2."id" < "Board"."id"))
);

-- DropIndex (replace the createdById-only index, keep nothing implicit on categoryId yet)
DROP INDEX IF EXISTS "Board_categoryId_idx";

-- CreateIndex (composite to support order-by within category)
CREATE INDEX "Board_categoryId_position_idx" ON "Board"("categoryId", "position");
