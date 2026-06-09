-- AlterTable
ALTER TABLE "DownloadTask" ADD COLUMN "requestId" TEXT;

-- CreateIndex
CREATE INDEX "DownloadTask_type_status_idx" ON "DownloadTask"("type", "status");
CREATE INDEX "DownloadTask_createdBy_idx" ON "DownloadTask"("createdBy");

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "username" TEXT,
    "role" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "path" TEXT,
    "method" TEXT,
    "requestId" TEXT,
    "durationMs" INTEGER,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PageViewLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "path" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "durationSeconds" INTEGER,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "OperationLog_userId_idx" ON "OperationLog"("userId");
CREATE INDEX "OperationLog_action_idx" ON "OperationLog"("action");
CREATE INDEX "OperationLog_module_idx" ON "OperationLog"("module");
CREATE INDEX "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");

-- CreateIndex
CREATE INDEX "PageViewLog_userId_idx" ON "PageViewLog"("userId");
CREATE INDEX "PageViewLog_page_idx" ON "PageViewLog"("page");
CREATE INDEX "PageViewLog_startedAt_idx" ON "PageViewLog"("startedAt");
