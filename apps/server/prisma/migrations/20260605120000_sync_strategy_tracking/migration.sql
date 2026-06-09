-- CreateTable
CREATE TABLE "OrderTrackingPool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL DEFAULT '',
    "reasons" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "orderMonth" TEXT,
    "lastStatusText" TEXT,
    "enteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    "syncJobId" TEXT
);

-- CreateTable
CREATE TABLE "HistoricalAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthKey" TEXT NOT NULL,
    "packageId" TEXT,
    "adjustmentType" TEXT NOT NULL,
    "amountCent" INTEGER NOT NULL,
    "occurredAt" DATETIME,
    "description" TEXT,
    "orderMonth" TEXT,
    "refundMonth" TEXT,
    "syncJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MonthlyDataStatus" (
    "monthKey" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "lastSyncedAt" DATETIME,
    "hasHistoricalAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "adjustmentAmountCent" INTEGER NOT NULL DEFAULT 0,
    "grossProfitStability" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderTrackingPool_packageId_skuId_key" ON "OrderTrackingPool"("packageId", "skuId");
CREATE INDEX "OrderTrackingPool_status_idx" ON "OrderTrackingPool"("status");
CREATE INDEX "OrderTrackingPool_lastCheckedAt_idx" ON "OrderTrackingPool"("lastCheckedAt");
CREATE INDEX "OrderTrackingPool_orderMonth_idx" ON "OrderTrackingPool"("orderMonth");
CREATE INDEX "HistoricalAdjustment_monthKey_idx" ON "HistoricalAdjustment"("monthKey");
CREATE INDEX "HistoricalAdjustment_packageId_idx" ON "HistoricalAdjustment"("packageId");
CREATE INDEX "HistoricalAdjustment_createdAt_idx" ON "HistoricalAdjustment"("createdAt");
