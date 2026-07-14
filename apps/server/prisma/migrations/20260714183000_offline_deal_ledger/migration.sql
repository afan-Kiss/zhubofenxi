-- CreateTable
CREATE TABLE "OfflineDeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealKey" TEXT NOT NULL,
    "externalKey" TEXT,
    "amountCent" INTEGER NOT NULL,
    "refundCent" INTEGER NOT NULL DEFAULT 0,
    "dealAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "anchorId" TEXT,
    "anchorName" TEXT,
    "customerLabel" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OfflineDealAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "dealKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "beforeAnchorId" TEXT,
    "afterAnchorId" TEXT,
    "operator" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "OfflineDeal_dealKey_key" ON "OfflineDeal"("dealKey");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineDeal_externalKey_key" ON "OfflineDeal"("externalKey");

-- CreateIndex
CREATE INDEX "OfflineDeal_dealAt_status_idx" ON "OfflineDeal"("dealAt", "status");

-- CreateIndex
CREATE INDEX "OfflineDeal_anchorId_idx" ON "OfflineDeal"("anchorId");

-- CreateIndex
CREATE INDEX "OfflineDeal_status_idx" ON "OfflineDeal"("status");

-- CreateIndex
CREATE INDEX "OfflineDeal_deletedAt_idx" ON "OfflineDeal"("deletedAt");

-- CreateIndex
CREATE INDEX "OfflineDealAuditLog_dealId_createdAt_idx" ON "OfflineDealAuditLog"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "OfflineDealAuditLog_dealKey_idx" ON "OfflineDealAuditLog"("dealKey");

-- CreateIndex
CREATE INDEX "OfflineDealAuditLog_createdAt_idx" ON "OfflineDealAuditLog"("createdAt");
