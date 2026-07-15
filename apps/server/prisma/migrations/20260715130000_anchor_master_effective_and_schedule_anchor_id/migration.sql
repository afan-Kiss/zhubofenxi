-- AlterTable Anchor: 上岗/离岗业务日
ALTER TABLE "Anchor" ADD COLUMN "effectiveFrom" TEXT;
ALTER TABLE "Anchor" ADD COLUMN "effectiveTo" TEXT;

-- AlterTable AnchorScheduleTemplate: 稳定主播关联
ALTER TABLE "AnchorScheduleTemplate" ADD COLUMN "anchorId" TEXT;
CREATE INDEX "AnchorScheduleTemplate_anchorId_idx" ON "AnchorScheduleTemplate"("anchorId");

-- AlterTable AnchorDailySchedule: 稳定主播关联
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "anchorId" TEXT;
CREATE INDEX "AnchorDailySchedule_anchorId_idx" ON "AnchorDailySchedule"("anchorId");
