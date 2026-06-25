-- CreateTable
CREATE TABLE "ProductDimension" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productKey" TEXT NOT NULL,
    "productCode" TEXT,
    "productName" TEXT,
    "skuName" TEXT,
    "ringSize" TEXT,
    "barType" TEXT,
    "productRole" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OpsReviewNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportDate" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "problemText" TEXT NOT NULL DEFAULT '',
    "reasonText" TEXT NOT NULL DEFAULT '',
    "trafficProductsJson" TEXT NOT NULL DEFAULT '[]',
    "mainProductsJson" TEXT NOT NULL DEFAULT '[]',
    "profitProductsJson" TEXT NOT NULL DEFAULT '[]',
    "scriptText" TEXT NOT NULL DEFAULT '',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductDimension_productKey_key" ON "ProductDimension"("productKey");

-- CreateIndex
CREATE INDEX "ProductDimension_productCode_idx" ON "ProductDimension"("productCode");

-- CreateIndex
CREATE UNIQUE INDEX "OpsReviewNote_reportDate_reportType_key" ON "OpsReviewNote"("reportDate", "reportType");

-- CreateIndex
CREATE INDEX "OpsReviewNote_reportType_idx" ON "OpsReviewNote"("reportType");
