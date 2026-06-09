-- PlatformCredential: live account + cookie health fields
ALTER TABLE "PlatformCredential" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PlatformCredential" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PlatformCredential" ADD COLUMN "cookieStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "PlatformCredential" ADD COLUMN "cookieLastCheckedAt" DATETIME;
ALTER TABLE "PlatformCredential" ADD COLUMN "cookieLastSuccessAt" DATETIME;
ALTER TABLE "PlatformCredential" ADD COLUMN "cookieLastFailedAt" DATETIME;
ALTER TABLE "PlatformCredential" ADD COLUMN "cookieLastErrorCode" TEXT;
ALTER TABLE "PlatformCredential" ADD COLUMN "cookieLastErrorMessage" TEXT;
ALTER TABLE "PlatformCredential" ADD COLUMN "cookieLastFailedApi" TEXT;
ALTER TABLE "PlatformCredential" ADD COLUMN "affectedBusinessSync" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformCredential" ADD COLUMN "lastSyncSuccessAt" DATETIME;

UPDATE "PlatformCredential" SET "displayName" = COALESCE(NULLIF("remark", ''), '默认') WHERE "displayName" = '';

-- XhsRawOrder: add live account source + composite unique
CREATE TABLE "new_XhsRawOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "packageId" TEXT,
    "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
    "liveAccountName" TEXT,
    "orderTime" DATETIME,
    "buyerId" TEXT,
    "rawJson" JSONB NOT NULL,
    "syncJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_XhsRawOrder" ("id", "orderId", "packageId", "liveAccountId", "liveAccountName", "orderTime", "buyerId", "rawJson", "syncJobId", "createdAt", "updatedAt")
SELECT "id", "orderId", "packageId", 'legacy', NULL, "orderTime", "buyerId", "rawJson", "syncJobId", "createdAt", "updatedAt" FROM "XhsRawOrder";
DROP TABLE "XhsRawOrder";
ALTER TABLE "new_XhsRawOrder" RENAME TO "XhsRawOrder";
CREATE UNIQUE INDEX "XhsRawOrder_liveAccountId_packageId_key" ON "XhsRawOrder"("liveAccountId", "packageId");
CREATE INDEX "XhsRawOrder_orderId_idx" ON "XhsRawOrder"("orderId");
CREATE INDEX "XhsRawOrder_liveAccountId_orderId_idx" ON "XhsRawOrder"("liveAccountId", "orderId");
CREATE INDEX "XhsRawOrder_orderTime_idx" ON "XhsRawOrder"("orderTime");
CREATE INDEX "XhsRawOrder_buyerId_idx" ON "XhsRawOrder"("buyerId");

-- XhsRawLiveSession: live account source
ALTER TABLE "XhsRawLiveSession" ADD COLUMN "liveAccountId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "XhsRawLiveSession" ADD COLUMN "liveAccountName" TEXT;
CREATE INDEX "XhsRawLiveSession_liveAccountId_idx" ON "XhsRawLiveSession"("liveAccountId");
