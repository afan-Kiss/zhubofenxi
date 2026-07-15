-- Wave 3: queue claim/audit, shop circuit, range sync meta
-- SQLite: ADD COLUMN 不可使用非常量 DEFAULT（如 CURRENT_TIMESTAMP）

-- AlterTable XhsAfterSalesWorkbenchQueue
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "workerId" TEXT;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "claimToken" TEXT;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "claimedAt" DATETIME;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "statusChangedAt" DATETIME;

UPDATE "XhsAfterSalesWorkbenchQueue"
SET "statusChangedAt" = COALESCE("updatedAt", "createdAt")
WHERE "statusChangedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "XhsAfterSalesWorkbenchQueue_liveAccountId_status_nextAttemptAt_idx"
  ON "XhsAfterSalesWorkbenchQueue"("liveAccountId", "status", "nextAttemptAt");

-- CreateTable XhsAfterSalesQueueAudit
CREATE TABLE IF NOT EXISTS "XhsAfterSalesQueueAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
    "orderNo" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "errorType" TEXT,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "workerId" TEXT,
    "claimToken" TEXT,
    "cacheStatus" TEXT,
    "orderAfterSaleStatus" TEXT,
    "operator" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "XhsAfterSalesQueueAudit_liveAccountId_createdAt_idx"
  ON "XhsAfterSalesQueueAudit"("liveAccountId", "createdAt");
CREATE INDEX IF NOT EXISTS "XhsAfterSalesQueueAudit_orderNo_idx" ON "XhsAfterSalesQueueAudit"("orderNo");
CREATE INDEX IF NOT EXISTS "XhsAfterSalesQueueAudit_createdAt_idx" ON "XhsAfterSalesQueueAudit"("createdAt");

-- CreateTable ShopAfterSalesRuntime
CREATE TABLE IF NOT EXISTS "ShopAfterSalesRuntime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveAccountId" TEXT NOT NULL,
    "platformName" TEXT NOT NULL DEFAULT '',
    "circuitOpen" BOOLEAN NOT NULL DEFAULT false,
    "circuitReason" TEXT,
    "circuitOpenedAt" DATETIME,
    "circuitNextProbeAt" DATETIME,
    "consecutiveAuthFail" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSignFail" INTEGER NOT NULL DEFAULT 0,
    "consecutiveCooling" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastErrorType" TEXT,
    "lastErrorMessage" TEXT,
    "completedPerMinute" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopAfterSalesRuntime_liveAccountId_key" UNIQUE ("liveAccountId")
);

CREATE INDEX IF NOT EXISTS "ShopAfterSalesRuntime_circuitOpen_idx" ON "ShopAfterSalesRuntime"("circuitOpen");

-- CreateTable XhsAfterSalesRangeSyncMeta
CREATE TABLE IF NOT EXISTS "XhsAfterSalesRangeSyncMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rangeKey" TEXT NOT NULL,
    "liveAccountId" TEXT NOT NULL,
    "platformName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'running',
    "lastAttemptAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "completedAt" DATETIME,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "sourceVersion" TEXT NOT NULL DEFAULT 'after-sales-range-v1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XhsAfterSalesRangeSyncMeta_liveAccountId_rangeKey_key" UNIQUE ("liveAccountId", "rangeKey")
);

CREATE INDEX IF NOT EXISTS "XhsAfterSalesRangeSyncMeta_rangeKey_idx" ON "XhsAfterSalesRangeSyncMeta"("rangeKey");
CREATE INDEX IF NOT EXISTS "XhsAfterSalesRangeSyncMeta_status_idx" ON "XhsAfterSalesRangeSyncMeta"("status");
CREATE INDEX IF NOT EXISTS "XhsAfterSalesRangeSyncMeta_lastSuccessAt_idx" ON "XhsAfterSalesRangeSyncMeta"("lastSuccessAt");
