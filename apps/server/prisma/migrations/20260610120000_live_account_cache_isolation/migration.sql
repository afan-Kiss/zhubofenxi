-- 多直播号隔离：品退 / 售后工作台 / 售后时间查询缓存
PRAGMA foreign_keys=OFF;

-- QualityBadCase: caseKey 全局唯一 -> liveAccountId + caseKey
CREATE TABLE "new_QualityBadCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
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
INSERT INTO "new_QualityBadCase" (
    "id", "liveAccountId", "caseKey", "packageId", "sourceBizId", "itemId", "itemName", "itemImage",
    "problemType", "negativeReasonsJson", "feedbackContent", "feedbackTime", "packagePayTime", "rawJson",
    "matchedOrderNo", "matchedOrderId", "matchedAfterSaleId", "matchedBuyerId", "matchedBuyerNickname",
    "matchedAnchorId", "matchedAnchorName", "afterSaleStatus", "afterSaleReason", "afterSaleRefundAmountCent",
    "afterSaleRefunded", "source", "matchStatus", "confidence", "syncedAt", "createdAt", "updatedAt"
)
SELECT
    "id", 'legacy', "caseKey", "packageId", "sourceBizId", "itemId", "itemName", "itemImage",
    "problemType", "negativeReasonsJson", "feedbackContent", "feedbackTime", "packagePayTime", "rawJson",
    "matchedOrderNo", "matchedOrderId", "matchedAfterSaleId", "matchedBuyerId", "matchedBuyerNickname",
    "matchedAnchorId", "matchedAnchorName", "afterSaleStatus", "afterSaleReason", "afterSaleRefundAmountCent",
    "afterSaleRefunded", "source", "matchStatus", "confidence", "syncedAt", "createdAt", "updatedAt"
FROM "QualityBadCase";
DROP TABLE "QualityBadCase";
ALTER TABLE "new_QualityBadCase" RENAME TO "QualityBadCase";
CREATE UNIQUE INDEX "QualityBadCase_liveAccountId_caseKey_key" ON "QualityBadCase"("liveAccountId", "caseKey");
CREATE INDEX "QualityBadCase_liveAccountId_idx" ON "QualityBadCase"("liveAccountId");
CREATE INDEX "QualityBadCase_packageId_idx" ON "QualityBadCase"("packageId");
CREATE INDEX "QualityBadCase_sourceBizId_idx" ON "QualityBadCase"("sourceBizId");
CREATE INDEX "QualityBadCase_itemId_idx" ON "QualityBadCase"("itemId");
CREATE INDEX "QualityBadCase_packagePayTime_idx" ON "QualityBadCase"("packagePayTime");
CREATE INDEX "QualityBadCase_feedbackTime_idx" ON "QualityBadCase"("feedbackTime");
CREATE INDEX "QualityBadCase_matchedAnchorId_idx" ON "QualityBadCase"("matchedAnchorId");
CREATE INDEX "QualityBadCase_matchedBuyerId_idx" ON "QualityBadCase"("matchedBuyerId");

UPDATE "QualityBadCase"
SET "liveAccountId" = COALESCE(
  (SELECT "id" FROM "PlatformCredential" ORDER BY "createdAt" ASC LIMIT 1),
  'legacy'
)
WHERE "liveAccountId" = 'legacy';

-- XhsAfterSalesWorkbenchCache: orderNo 全局唯一 -> liveAccountId + orderNo
CREATE TABLE "new_XhsAfterSalesWorkbenchCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
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
INSERT INTO "new_XhsAfterSalesWorkbenchCache" (
    "id", "liveAccountId", "orderNo", "packageId", "officialRefundAmountCent", "expectedRefundAmountCent",
    "appliedAmountCent", "appliedShipFeeAmountCent", "payAmountCent", "settlementAmountCent",
    "refundIncludesFreight", "afterSaleReason", "afterSaleStatus", "successReturnCount", "returnsIds",
    "rawDetail", "fetchStatus", "fetchError", "fetchedAt", "createdAt", "updatedAt"
)
SELECT
    "id", 'legacy', "orderNo", "packageId", "officialRefundAmountCent", "expectedRefundAmountCent",
    "appliedAmountCent", "appliedShipFeeAmountCent", "payAmountCent", "settlementAmountCent",
    "refundIncludesFreight", "afterSaleReason", "afterSaleStatus", "successReturnCount", "returnsIds",
    "rawDetail", "fetchStatus", "fetchError", "fetchedAt", "createdAt", "updatedAt"
FROM "XhsAfterSalesWorkbenchCache";
DROP TABLE "XhsAfterSalesWorkbenchCache";
ALTER TABLE "new_XhsAfterSalesWorkbenchCache" RENAME TO "XhsAfterSalesWorkbenchCache";
CREATE UNIQUE INDEX "XhsAfterSalesWorkbenchCache_liveAccountId_orderNo_key" ON "XhsAfterSalesWorkbenchCache"("liveAccountId", "orderNo");
CREATE INDEX "XhsAfterSalesWorkbenchCache_fetchStatus_idx" ON "XhsAfterSalesWorkbenchCache"("fetchStatus");
CREATE INDEX "XhsAfterSalesWorkbenchCache_liveAccountId_idx" ON "XhsAfterSalesWorkbenchCache"("liveAccountId");

UPDATE "XhsAfterSalesWorkbenchCache"
SET "liveAccountId" = COALESCE(
  (SELECT "id" FROM "PlatformCredential" ORDER BY "createdAt" ASC LIMIT 1),
  'legacy'
)
WHERE "liveAccountId" = 'legacy';

-- XhsAfterSalesWorkbenchQueue
CREATE TABLE "new_XhsAfterSalesWorkbenchQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
    "orderNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_XhsAfterSalesWorkbenchQueue" (
    "id", "liveAccountId", "orderNo", "status", "attempts", "lastError", "createdAt", "updatedAt"
)
SELECT
    "id", 'legacy', "orderNo", "status", "attempts", "lastError", "createdAt", "updatedAt"
FROM "XhsAfterSalesWorkbenchQueue";
DROP TABLE "XhsAfterSalesWorkbenchQueue";
ALTER TABLE "new_XhsAfterSalesWorkbenchQueue" RENAME TO "XhsAfterSalesWorkbenchQueue";
CREATE UNIQUE INDEX "XhsAfterSalesWorkbenchQueue_liveAccountId_orderNo_key" ON "XhsAfterSalesWorkbenchQueue"("liveAccountId", "orderNo");
CREATE INDEX "XhsAfterSalesWorkbenchQueue_status_idx" ON "XhsAfterSalesWorkbenchQueue"("status");
CREATE INDEX "XhsAfterSalesWorkbenchQueue_liveAccountId_idx" ON "XhsAfterSalesWorkbenchQueue"("liveAccountId");

UPDATE "XhsAfterSalesWorkbenchQueue"
SET "liveAccountId" = COALESCE(
  (SELECT "id" FROM "PlatformCredential" ORDER BY "createdAt" ASC LIMIT 1),
  'legacy'
)
WHERE "liveAccountId" = 'legacy';

-- XhsAfterSalesTimeSearchCache: platformName 唯一维度 -> liveAccountId + returnId + rangeKey
CREATE TABLE "new_XhsAfterSalesTimeSearchCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
    "returnId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "platformName" TEXT NOT NULL DEFAULT 'merged',
    "rangeKey" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_XhsAfterSalesTimeSearchCache" (
    "id", "liveAccountId", "returnId", "orderNo", "platformName", "rangeKey", "rawJson", "syncedAt", "createdAt", "updatedAt"
)
SELECT
    "id",
    COALESCE(
      (SELECT "id" FROM "PlatformCredential" WHERE "platformName" = "XhsAfterSalesTimeSearchCache"."platformName" LIMIT 1),
      (SELECT "id" FROM "PlatformCredential" ORDER BY "createdAt" ASC LIMIT 1),
      'legacy'
    ),
    "returnId", "orderNo", "platformName", "rangeKey", "rawJson", "syncedAt", "createdAt", "updatedAt"
FROM "XhsAfterSalesTimeSearchCache";
DROP TABLE "XhsAfterSalesTimeSearchCache";
ALTER TABLE "new_XhsAfterSalesTimeSearchCache" RENAME TO "XhsAfterSalesTimeSearchCache";
CREATE UNIQUE INDEX "XhsAfterSalesTimeSearchCache_liveAccountId_returnId_rangeKey_key" ON "XhsAfterSalesTimeSearchCache"("liveAccountId", "returnId", "rangeKey");
CREATE INDEX "XhsAfterSalesTimeSearchCache_orderNo_idx" ON "XhsAfterSalesTimeSearchCache"("orderNo");
CREATE INDEX "XhsAfterSalesTimeSearchCache_rangeKey_idx" ON "XhsAfterSalesTimeSearchCache"("rangeKey");
CREATE INDEX "XhsAfterSalesTimeSearchCache_liveAccountId_idx" ON "XhsAfterSalesTimeSearchCache"("liveAccountId");

PRAGMA foreign_keys=ON;
