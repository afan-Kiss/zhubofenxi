-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT NOT NULL DEFAULT 'idle',
    "currentStepLabel" TEXT NOT NULL DEFAULT '等待开始',
    "downloadBatchId" TEXT,
    "trustStatus" TEXT,
    "errorMessage" TEXT,
    "startedBy" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AnalysisSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refreshJobId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "trustStatus" TEXT NOT NULL,
    "officialDataAvailable" BOOLEAN NOT NULL DEFAULT false,
    "overviewJson" TEXT NOT NULL,
    "anchorSummariesJson" TEXT NOT NULL,
    "buyerReturnRankingJson" TEXT NOT NULL,
    "buyerQualityReturnRankingJson" TEXT NOT NULL,
    "returnDetailsJson" TEXT NOT NULL,
    "trustChecksJson" TEXT,
    "warningsJson" TEXT NOT NULL,
    "errorsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisSnapshot_refreshJobId_fkey" FOREIGN KEY ("refreshJobId") REFERENCES "RefreshJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RefreshJob_status_idx" ON "RefreshJob"("status");
CREATE INDEX "RefreshJob_type_idx" ON "RefreshJob"("type");
CREATE INDEX "RefreshJob_createdAt_idx" ON "RefreshJob"("createdAt");
CREATE INDEX "AnalysisSnapshot_refreshJobId_idx" ON "AnalysisSnapshot"("refreshJobId");
CREATE INDEX "AnalysisSnapshot_createdAt_idx" ON "AnalysisSnapshot"("createdAt");
CREATE INDEX "AnalysisSnapshot_trustStatus_idx" ON "AnalysisSnapshot"("trustStatus");
