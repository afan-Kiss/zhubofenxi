-- CreateTable
CREATE TABLE "GoodReviewShopSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "shopScore" REAL,
    "totalReviewCount" INTEGER NOT NULL DEFAULT 0,
    "goodReviewCount" INTEGER NOT NULL DEFAULT 0,
    "mediumReviewCount" INTEGER NOT NULL DEFAULT 0,
    "badReviewCount" INTEGER NOT NULL DEFAULT 0,
    "withImageCount" INTEGER NOT NULL DEFAULT 0,
    "withTextCount" INTEGER NOT NULL DEFAULT 0,
    "unrepliedCount" INTEGER NOT NULL DEFAULT 0,
    "repliedCount" INTEGER NOT NULL DEFAULT 0,
    "pendingInteractionCount" INTEGER NOT NULL DEFAULT 0,
    "pendingBadReviewCount" INTEGER NOT NULL DEFAULT 0,
    "scoreRawJson" TEXT,
    "countDetailRawJson" TEXT,
    "overviewRawJson" TEXT,
    "syncedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GoodReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "reviewId" TEXT,
    "orderId" TEXT,
    "itemId" TEXT,
    "skuId" TEXT,
    "itemName" TEXT,
    "itemImage" TEXT,
    "itemPriceCent" INTEGER,
    "itemQuantity" INTEGER,
    "productScore" REAL,
    "serviceScore" REAL,
    "logisticsScore" REAL,
    "reviewText" TEXT,
    "reviewImagesJson" TEXT NOT NULL DEFAULT '[]',
    "reviewTagsJson" TEXT NOT NULL DEFAULT '[]',
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "reviewTime" DATETIME,
    "reviewTimeText" TEXT,
    "rawJson" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GoodReviewSyncMeta" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "lastSyncedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "GoodReviewShopSnapshot_shopKey_key" ON "GoodReviewShopSnapshot"("shopKey");

-- CreateIndex
CREATE UNIQUE INDEX "GoodReview_shopKey_dedupeKey_key" ON "GoodReview"("shopKey", "dedupeKey");

-- CreateIndex
CREATE INDEX "GoodReview_shopKey_idx" ON "GoodReview"("shopKey");

-- CreateIndex
CREATE INDEX "GoodReview_reviewTime_idx" ON "GoodReview"("reviewTime");

-- CreateIndex
CREATE INDEX "GoodReview_reviewId_idx" ON "GoodReview"("reviewId");
