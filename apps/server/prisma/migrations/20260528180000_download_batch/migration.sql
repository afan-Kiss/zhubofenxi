-- CreateTable
CREATE TABLE "DownloadBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "createdBy" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AlterTable
ALTER TABLE "DownloadTask" ADD COLUMN "batchId" TEXT;
ALTER TABLE "DownloadTask" ADD COLUMN "step" TEXT;
ALTER TABLE "DownloadTask" ADD COLUMN "durationMs" INTEGER;

CREATE INDEX "DownloadBatch_createdBy_idx" ON "DownloadBatch"("createdBy");
CREATE INDEX "DownloadBatch_createdAt_idx" ON "DownloadBatch"("createdAt");
CREATE INDEX "DownloadTask_batchId_idx" ON "DownloadTask"("batchId");
