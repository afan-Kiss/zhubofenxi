-- CreateTable
CREATE TABLE "XhsAfterSalesWorkbenchCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "packageId" TEXT,
    "officialRefundAmountCent" INTEGER NOT NULL DEFAULT 0,
    "expectedRefundAmountCent" INTEGER,
    "appliedAmountCent" INTEGER,
    "appliedShipFeeAmountCent" INTEGER NOT NULL DEFAULT 0,
    "payAmountCent" INTEGER,
    "settlementAmountCent" INTEGER,
    "refundIncludesFreight" BOOLEAN NOT NULL DEFAULT false,
    "afterSaleReason" TEXT,
    "afterSaleStatus" TEXT,
    "successReturnCount" INTEGER NOT NULL DEFAULT 0,
    "returnsIds" TEXT,
    "rawDetail" JSONB,
    "fetchStatus" TEXT NOT NULL DEFAULT 'pending',
    "fetchError" TEXT,
    "fetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "XhsAfterSalesWorkbenchCache_orderNo_key" ON "XhsAfterSalesWorkbenchCache"("orderNo");
CREATE INDEX "XhsAfterSalesWorkbenchCache_fetchStatus_idx" ON "XhsAfterSalesWorkbenchCache"("fetchStatus");

CREATE TABLE "XhsAfterSalesWorkbenchQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "XhsAfterSalesWorkbenchQueue_orderNo_key" ON "XhsAfterSalesWorkbenchQueue"("orderNo");
CREATE INDEX "XhsAfterSalesWorkbenchQueue_status_idx" ON "XhsAfterSalesWorkbenchQueue"("status");
