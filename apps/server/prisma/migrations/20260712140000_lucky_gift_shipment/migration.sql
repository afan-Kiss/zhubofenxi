-- CreateTable
CREATE TABLE "XhsLuckyDraw" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL,
    "liveAccountName" TEXT NOT NULL,
    "luckyDrawId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL DEFAULT '',
    "giftName" TEXT NOT NULL DEFAULT '',
    "senderUserId" TEXT,
    "senderNickname" TEXT,
    "drawStatus" INTEGER,
    "winnerCount" INTEGER NOT NULL DEFAULT 0,
    "createTime" DATETIME,
    "startTime" DATETIME,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "XhsLuckyWinner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL,
    "liveAccountName" TEXT NOT NULL,
    "luckyDrawId" TEXT NOT NULL,
    "winnerUserId" TEXT NOT NULL DEFAULT '',
    "winnerKey" TEXT NOT NULL,
    "redId" TEXT,
    "winnerNickname" TEXT NOT NULL DEFAULT '',
    "avatar" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "province" TEXT,
    "city" TEXT,
    "district" TEXT,
    "addressDetail" TEXT,
    "fullAddress" TEXT,
    "hasAddress" BOOLEAN NOT NULL DEFAULT false,
    "addressComplete" BOOLEAN NOT NULL DEFAULT false,
    "addressMissingJson" TEXT NOT NULL DEFAULT '[]',
    "firstAddressSeenAt" DATETIME,
    "winTime" DATETIME,
    "officialCourier" TEXT,
    "officialTrackingNo" TEXT,
    "officialShipped" BOOLEAN NOT NULL DEFAULT false,
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XhsLuckyWinner_liveAccountId_luckyDrawId_fkey" FOREIGN KEY ("liveAccountId", "luckyDrawId") REFERENCES "XhsLuckyDraw" ("liveAccountId", "luckyDrawId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LuckyGiftShipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "winnerId" TEXT NOT NULL,
    "shipmentStatus" TEXT NOT NULL DEFAULT 'no_address',
    "shippingStatusSource" TEXT NOT NULL DEFAULT 'local',
    "freightType" TEXT NOT NULL DEFAULT 'COLLECT',
    "courierCompany" TEXT,
    "trackingNo" TEXT,
    "markedShippedAt" DATETIME,
    "markedShippedBy" TEXT,
    "shipmentNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LuckyGiftShipment_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "XhsLuckyWinner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LuckyGiftShipmentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "winnerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "operatorId" TEXT,
    "operatorName" TEXT,
    "note" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LuckyGiftShipmentLog_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "LuckyGiftShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LuckyGiftSyncMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL,
    "liveAccountName" TEXT NOT NULL DEFAULT '',
    "lastSyncedAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT,
    "lastTrigger" TEXT,
    "drawCount" INTEGER NOT NULL DEFAULT 0,
    "winnerCount" INTEGER NOT NULL DEFAULT 0,
    "platformTotal" INTEGER,
    "fetchedCount" INTEGER,
    "dedupedCount" INTEGER,
    "detailFailCount" INTEGER NOT NULL DEFAULT 0,
    "newDrawCount" INTEGER NOT NULL DEFAULT 0,
    "newAddressCount" INTEGER NOT NULL DEFAULT 0,
    "statusChangeCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LuckyGiftSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "lastSyncedAt" DATETIME,
    "lastTrigger" TEXT,
    "successShopCount" INTEGER NOT NULL DEFAULT 0,
    "failedShopCount" INTEGER NOT NULL DEFAULT 0,
    "failedShopsJson" TEXT NOT NULL DEFAULT '[]',
    "newDrawCount" INTEGER NOT NULL DEFAULT 0,
    "newAddressCount" INTEGER NOT NULL DEFAULT 0,
    "statusChangeCount" INTEGER NOT NULL DEFAULT 0,
    "summaryJson" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "XhsLuckyDraw_liveAccountId_luckyDrawId_key" ON "XhsLuckyDraw"("liveAccountId", "luckyDrawId");

-- CreateIndex
CREATE INDEX "XhsLuckyDraw_liveAccountId_idx" ON "XhsLuckyDraw"("liveAccountId");

-- CreateIndex
CREATE INDEX "XhsLuckyDraw_createTime_idx" ON "XhsLuckyDraw"("createTime");

-- CreateIndex
CREATE INDEX "XhsLuckyDraw_lastSyncedAt_idx" ON "XhsLuckyDraw"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "XhsLuckyWinner_liveAccountId_luckyDrawId_winnerKey_key" ON "XhsLuckyWinner"("liveAccountId", "luckyDrawId", "winnerKey");

-- CreateIndex
CREATE INDEX "XhsLuckyWinner_liveAccountId_idx" ON "XhsLuckyWinner"("liveAccountId");

-- CreateIndex
CREATE INDEX "XhsLuckyWinner_luckyDrawId_idx" ON "XhsLuckyWinner"("luckyDrawId");

-- CreateIndex
CREATE INDEX "XhsLuckyWinner_winnerUserId_idx" ON "XhsLuckyWinner"("winnerUserId");

-- CreateIndex
CREATE INDEX "XhsLuckyWinner_hasAddress_addressComplete_idx" ON "XhsLuckyWinner"("hasAddress", "addressComplete");

-- CreateIndex
CREATE INDEX "XhsLuckyWinner_winTime_idx" ON "XhsLuckyWinner"("winTime");

-- CreateIndex
CREATE UNIQUE INDEX "LuckyGiftShipment_winnerId_key" ON "LuckyGiftShipment"("winnerId");

-- CreateIndex
CREATE INDEX "LuckyGiftShipment_shipmentStatus_idx" ON "LuckyGiftShipment"("shipmentStatus");

-- CreateIndex
CREATE INDEX "LuckyGiftShipment_shippingStatusSource_idx" ON "LuckyGiftShipment"("shippingStatusSource");

-- CreateIndex
CREATE INDEX "LuckyGiftShipment_markedShippedAt_idx" ON "LuckyGiftShipment"("markedShippedAt");

-- CreateIndex
CREATE INDEX "LuckyGiftShipmentLog_shipmentId_createdAt_idx" ON "LuckyGiftShipmentLog"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "LuckyGiftShipmentLog_winnerId_idx" ON "LuckyGiftShipmentLog"("winnerId");

-- CreateIndex
CREATE UNIQUE INDEX "LuckyGiftSyncMeta_liveAccountId_key" ON "LuckyGiftSyncMeta"("liveAccountId");
