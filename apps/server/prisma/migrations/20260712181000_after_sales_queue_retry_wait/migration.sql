-- 售后队列：支持 retry_wait / blocked / nextAttemptAt 等字段
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "temporaryAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "permanentFailureCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "errorType" TEXT;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "nextAttemptAt" DATETIME;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "lastAttemptAt" DATETIME;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "runningSince" DATETIME;

CREATE INDEX "XhsAfterSalesWorkbenchQueue_status_nextAttemptAt_idx"
  ON "XhsAfterSalesWorkbenchQueue"("status", "nextAttemptAt");

-- 历史冷却失败 → retry_wait（保留 lastError，分散 nextAttemptAt）
UPDATE "XhsAfterSalesWorkbenchQueue"
SET
  "status" = 'retry_wait',
  "errorType" = 'platform_cooling',
  "temporaryAttemptCount" = CASE WHEN "temporaryAttemptCount" > 0 THEN "temporaryAttemptCount" ELSE "attempts" END,
  "nextAttemptAt" = datetime('now', printf('+%d minutes', 5 + (abs(random()) % 3)))
WHERE "status" = 'failed' AND "lastError" LIKE '%冷却%';

-- 历史 Python2 签名失败 → retry_wait（待 Python3 正式部署后恢复）
UPDATE "XhsAfterSalesWorkbenchQueue"
SET
  "status" = 'retry_wait',
  "errorType" = 'sign_python2_interpreter',
  "temporaryAttemptCount" = CASE WHEN "temporaryAttemptCount" > 0 THEN "temporaryAttemptCount" ELSE "attempts" END,
  "nextAttemptAt" = datetime('now', printf('+%d minutes', 10 + (abs(random()) % 5)))
WHERE "status" = 'failed'
  AND (
    "lastError" LIKE '%签名%'
    OR "lastError" LIKE '%annotations%'
    OR "lastError" LIKE '%SyntaxError%'
  );
