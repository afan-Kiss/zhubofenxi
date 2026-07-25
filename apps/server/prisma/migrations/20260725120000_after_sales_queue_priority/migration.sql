-- AlterTable
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "triggerReason" TEXT;
ALTER TABLE "XhsAfterSalesWorkbenchQueue" ADD COLUMN "signalDetectedAt" DATETIME;

-- CreateIndex
CREATE INDEX "XhsAfterSalesWorkbenchQueue_liveAccountId_status_priority_nextAttemptAt_idx" ON "XhsAfterSalesWorkbenchQueue"("liveAccountId", "status", "priority", "nextAttemptAt");
