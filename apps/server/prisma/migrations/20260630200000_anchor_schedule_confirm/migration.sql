-- AlterTable
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "confirmedAt" DATETIME;
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "confirmedBy" TEXT;
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "confirmNote" TEXT;

CREATE INDEX "AnchorDailySchedule_scheduleDate_confirmed_idx" ON "AnchorDailySchedule"("scheduleDate", "confirmed");
