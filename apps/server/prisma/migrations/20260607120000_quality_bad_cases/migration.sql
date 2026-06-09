-- CreateTable
CREATE TABLE "QualityBadCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseKey" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "sourceBizId" TEXT,
    "itemId" TEXT,
    "itemName" TEXT,
    "itemImage" TEXT,
    "problemType" TEXT NOT NULL DEFAULT '品质问题',
    "negativeReasonsJson" TEXT NOT NULL DEFAULT '[]',
    "feedbackContent" TEXT,
    "feedbackTime" TEXT,
    "packagePayTime" TEXT,
    "rawJson" TEXT,
    "matchedOrderNo" TEXT,
    "matchedOrderId" TEXT,
    "matchedAfterSaleId" TEXT,
    "matchedBuyerId" TEXT,
    "matchedBuyerNickname" TEXT,
    "matchedAnchorId" TEXT,
    "matchedAnchorName" TEXT,
    "afterSaleStatus" TEXT,
    "afterSaleReason" TEXT,
    "afterSaleRefundAmountCent" INTEGER NOT NULL DEFAULT 0,
    "afterSaleRefunded" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'official_quality_badcase',
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "confidence" TEXT NOT NULL DEFAULT 'high',
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "QualityBadCase_caseKey_key" ON "QualityBadCase"("caseKey");
CREATE INDEX "QualityBadCase_packageId_idx" ON "QualityBadCase"("packageId");
CREATE INDEX "QualityBadCase_sourceBizId_idx" ON "QualityBadCase"("sourceBizId");
CREATE INDEX "QualityBadCase_itemId_idx" ON "QualityBadCase"("itemId");
CREATE INDEX "QualityBadCase_packagePayTime_idx" ON "QualityBadCase"("packagePayTime");
CREATE INDEX "QualityBadCase_feedbackTime_idx" ON "QualityBadCase"("feedbackTime");
CREATE INDEX "QualityBadCase_matchedAnchorId_idx" ON "QualityBadCase"("matchedAnchorId");
CREATE INDEX "QualityBadCase_matchedBuyerId_idx" ON "QualityBadCase"("matchedBuyerId");

CREATE TABLE "QualityBadCaseSyncMeta" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "source" TEXT NOT NULL DEFAULT 'official_quality_badcase',
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "startTime" TEXT,
    "endTime" TEXT,
    "lastSyncedAt" DATETIME,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "matchedOrderCount" INTEGER NOT NULL DEFAULT 0,
    "matchedAfterSaleCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);
