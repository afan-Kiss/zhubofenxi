-- CreateTable
CREATE TABLE "BossPendingSettlementSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "liveAccountId" TEXT NOT NULL,
    "pendingAmountCent" INTEGER,
    "sellerAccountAmountCent" INTEGER,
    "alipayAmountCent" INTEGER,
    "wechatAmountCent" INTEGER,
    "pendingOrderCount" INTEGER,
    "rangeStart" DATETIME,
    "rangeEnd" DATETIME,
    "settlePeriodDays" INTEGER,
    "syncStatus" TEXT NOT NULL DEFAULT 'success',
    "syncError" TEXT,
    "reconciliationDiffCent" INTEGER,
    "fundReconcileStatus" TEXT,
    "fundReconcileDiffCent" INTEGER,
    "fundReconcileCheckedAt" DATETIME,
    "fetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BossPendingSettlementOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "liveAccountId" TEXT NOT NULL,
    "platformSettleNo" TEXT NOT NULL,
    "packageId" TEXT,
    "orderCreateTime" DATETIME,
    "orderStatus" TEXT,
    "orderFinishTime" DATETIME,
    "settleStatus" TEXT,
    "expectedSettleTime" DATETIME,
    "transactionType" TEXT,
    "sellerIncomeCent" INTEGER,
    "totalIncomeCent" INTEGER,
    "totalOutcomeCent" INTEGER,
    "platformCommissionCent" INTEGER,
    "cpsCommissionCent" INTEGER,
    "installmentFeeCent" INTEGER,
    "lastSeenAt" DATETIME,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BossSettlementPeriodBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "liveAccountId" TEXT NOT NULL,
    "platformBillNo" TEXT,
    "periodType" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "billDate" TEXT,
    "processStatus" TEXT,
    "settleOrderCount" INTEGER,
    "otherOrderCount" INTEGER,
    "totalCount" INTEGER,
    "totalIncomeCent" INTEGER,
    "totalOutcomeCent" INTEGER,
    "totalChangeCent" INTEGER,
    "totalCommissionCent" INTEGER,
    "feeDetailJson" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'official',
    "processFinishedAt" DATETIME,
    "fetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "BossPendingSettlementSnapshot_shopKey_updatedAt_idx" ON "BossPendingSettlementSnapshot"("shopKey", "updatedAt");

-- CreateIndex
CREATE INDEX "BossPendingSettlementSnapshot_liveAccountId_idx" ON "BossPendingSettlementSnapshot"("liveAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BossPendingSettlementOrder_shopKey_platformSettleNo_key" ON "BossPendingSettlementOrder"("shopKey", "platformSettleNo");

-- CreateIndex
CREATE INDEX "BossPendingSettlementOrder_shopKey_isCurrent_orderCreateTime_idx" ON "BossPendingSettlementOrder"("shopKey", "isCurrent", "orderCreateTime");

-- CreateIndex
CREATE INDEX "BossPendingSettlementOrder_liveAccountId_idx" ON "BossPendingSettlementOrder"("liveAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BossSettlementPeriodBill_shopKey_periodType_periodStart_key" ON "BossSettlementPeriodBill"("shopKey", "periodType", "periodStart");

-- CreateIndex
CREATE INDEX "BossSettlementPeriodBill_shopKey_periodType_billDate_idx" ON "BossSettlementPeriodBill"("shopKey", "periodType", "billDate");

-- CreateIndex
CREATE INDEX "BossSettlementPeriodBill_liveAccountId_idx" ON "BossSettlementPeriodBill"("liveAccountId");
