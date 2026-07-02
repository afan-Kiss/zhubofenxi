-- CreateTable
CREATE TABLE "OrderAnchorManualOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderKey" TEXT NOT NULL,
    "anchorName" TEXT NOT NULL,
    "anchorId" TEXT,
    "assignedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderAnchorManualOverride_orderKey_key" ON "OrderAnchorManualOverride"("orderKey");

-- CreateIndex
CREATE INDEX "OrderAnchorManualOverride_anchorName_idx" ON "OrderAnchorManualOverride"("anchorName");
