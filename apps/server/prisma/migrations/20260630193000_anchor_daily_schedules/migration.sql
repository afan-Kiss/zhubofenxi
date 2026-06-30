-- CreateTable
CREATE TABLE "AnchorScheduleTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anchorName" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "liveRoomName" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "effectiveFrom" TEXT,
    "effectiveTo" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AnchorDailySchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleDate" TEXT NOT NULL,
    "anchorName" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "liveRoomName" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AnchorScheduleTemplate_enabled_sortOrder_idx" ON "AnchorScheduleTemplate"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "AnchorDailySchedule_scheduleDate_idx" ON "AnchorDailySchedule"("scheduleDate");

-- CreateIndex
CREATE INDEX "AnchorDailySchedule_scheduleDate_enabled_idx" ON "AnchorDailySchedule"("scheduleDate", "enabled");
