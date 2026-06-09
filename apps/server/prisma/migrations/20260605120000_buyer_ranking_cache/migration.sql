-- CreateTable
CREATE TABLE "BuyerRankingCache" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "itemsJson" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL,
    "blacklistedBuyerIdsJson" TEXT NOT NULL DEFAULT '[]',
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "buyerCount" INTEGER NOT NULL DEFAULT 0,
    "builtAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastTrigger" TEXT
);
