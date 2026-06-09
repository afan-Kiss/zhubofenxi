PRAGMA foreign_keys=OFF;

-- XhsSyncJob counts
ALTER TABLE "XhsSyncJob" ADD COLUMN "orderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsSyncJob" ADD COLUMN "liveSessionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsSyncJob" ADD COLUMN "pendingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsSyncJob" ADD COLUMN "settledCount" INTEGER NOT NULL DEFAULT 0;

-- Pending settlement
CREATE TABLE "XhsRawPendingSettlement_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settleNo" TEXT,
    "packageId" TEXT,
    "orderTime" DATETIME,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

DROP TABLE "XhsRawPendingSettlement";
ALTER TABLE "XhsRawPendingSettlement_new" RENAME TO "XhsRawPendingSettlement";
CREATE INDEX "XhsRawPendingSettlement_settleNo_idx" ON "XhsRawPendingSettlement"("settleNo");
CREATE INDEX "XhsRawPendingSettlement_packageId_idx" ON "XhsRawPendingSettlement"("packageId");
CREATE INDEX "XhsRawPendingSettlement_orderTime_idx" ON "XhsRawPendingSettlement"("orderTime");

-- Settled settlement
CREATE TABLE "XhsRawSettledSettlement_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settleNo" TEXT,
    "packageId" TEXT,
    "orderTime" DATETIME,
    "settleTime" DATETIME,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

DROP TABLE "XhsRawSettledSettlement";
ALTER TABLE "XhsRawSettledSettlement_new" RENAME TO "XhsRawSettledSettlement";
CREATE INDEX "XhsRawSettledSettlement_settleNo_idx" ON "XhsRawSettledSettlement"("settleNo");
CREATE INDEX "XhsRawSettledSettlement_packageId_idx" ON "XhsRawSettledSettlement"("packageId");
CREATE INDEX "XhsRawSettledSettlement_orderTime_idx" ON "XhsRawSettledSettlement"("orderTime");
CREATE INDEX "XhsRawSettledSettlement_settleTime_idx" ON "XhsRawSettledSettlement"("settleTime");

PRAGMA foreign_keys=ON;
