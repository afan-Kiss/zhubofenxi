-- AlterTable AnchorDailySchedule: 临时试播主播（仅属于 scheduleDate 当天）
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "isTemporaryAnchor" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "temporaryAnchorKey" TEXT;
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "anchorColorSnapshot" TEXT;

CREATE INDEX "AnchorDailySchedule_scheduleDate_temporaryAnchorKey_idx"
  ON "AnchorDailySchedule"("scheduleDate", "temporaryAnchorKey");
