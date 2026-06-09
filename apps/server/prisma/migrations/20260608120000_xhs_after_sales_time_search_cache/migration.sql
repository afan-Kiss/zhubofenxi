-- CreateTable
CREATE TABLE "XhsAfterSalesTimeSearchCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "platformName" TEXT NOT NULL DEFAULT 'merged',
    "rangeKey" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "XhsAfterSalesTimeSearchCache_returnId_rangeKey_platformName_key" ON "XhsAfterSalesTimeSearchCache"("returnId", "rangeKey", "platformName");
CREATE INDEX "XhsAfterSalesTimeSearchCache_orderNo_idx" ON "XhsAfterSalesTimeSearchCache"("orderNo");
CREATE INDEX "XhsAfterSalesTimeSearchCache_rangeKey_idx" ON "XhsAfterSalesTimeSearchCache"("rangeKey");
