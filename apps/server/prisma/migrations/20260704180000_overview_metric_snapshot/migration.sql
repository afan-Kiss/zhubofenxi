-- CreateTable
CREATE TABLE "OverviewMetricSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthKey" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'lastMonth',
    "sourceSyncJobId" TEXT,
    "cacheBuiltAt" DATETIME NOT NULL,
    "totalGmv" REAL NOT NULL DEFAULT 0,
    "validSalesAmount" REAL NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "refundAmount" REAL NOT NULL DEFAULT 0,
    "qualityReturnCount" INTEGER NOT NULL DEFAULT 0,
    "dataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "OverviewMetricSnapshot_monthKey_preset_key" ON "OverviewMetricSnapshot"("monthKey", "preset");
CREATE INDEX "OverviewMetricSnapshot_cacheBuiltAt_idx" ON "OverviewMetricSnapshot"("cacheBuiltAt");
