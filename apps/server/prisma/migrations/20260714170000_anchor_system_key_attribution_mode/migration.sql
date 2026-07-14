-- AlterTable: Anchor system identity + attribution mode
-- SQLite: Prisma enums stored as TEXT

-- CreateTable / alter via recreate pattern not needed; ADD COLUMN supported
ALTER TABLE "Anchor" ADD COLUMN "systemKey" TEXT;
ALTER TABLE "Anchor" ADD COLUMN "attributionMode" TEXT NOT NULL DEFAULT 'schedule';

CREATE UNIQUE INDEX "Anchor_systemKey_key" ON "Anchor"("systemKey");

-- Bind historical 逸凡 (active) to system identity. If duplicates exist, only the
-- oldest non-deleted row is bound; remaining rows stay schedule and need manual review.
UPDATE "Anchor"
SET "systemKey" = 'YIFAN_MANUAL',
    "attributionMode" = 'manual',
    "defaultLiveRoomName" = NULL
WHERE "id" = (
  SELECT "id" FROM "Anchor"
  WHERE "name" = '逸凡' AND "deletedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
);

-- Soft-deleted 逸凡 with colliding name is left alone (unique name still holds);
-- initializeSystemAnchors will restore or reuse by systemKey when present.
