-- CreateTable
CREATE TABLE "XhsSyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT NOT NULL DEFAULT 'idle',
    "currentStepLabel" TEXT NOT NULL DEFAULT '等待开始',
    "totalRequestCount" INTEGER NOT NULL DEFAULT 0,
    "successRequestCount" INTEGER NOT NULL DEFAULT 0,
    "failedRequestCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedBy" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "refreshJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "XhsRawOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "orderTime" TEXT,
    "buyerId" TEXT,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XhsRawOrder_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "XhsSyncJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XhsRawOrderDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XhsRawOrderDetail_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "XhsSyncJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XhsRawLiveSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "anchorName" TEXT,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XhsRawLiveSession_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "XhsSyncJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XhsRawLiveSessionDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XhsRawLiveSessionDetail_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "XhsSyncJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XhsRawPendingSettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XhsRawPendingSettlement_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "XhsSyncJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XhsRawSettledSettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XhsRawSettledSettlement_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "XhsSyncJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "XhsSyncJob_status_idx" ON "XhsSyncJob"("status");
CREATE INDEX "XhsSyncJob_type_idx" ON "XhsSyncJob"("type");
CREATE INDEX "XhsSyncJob_createdAt_idx" ON "XhsSyncJob"("createdAt");

CREATE UNIQUE INDEX "XhsRawOrder_orderId_key" ON "XhsRawOrder"("orderId");
CREATE INDEX "XhsRawOrder_syncJobId_idx" ON "XhsRawOrder"("syncJobId");

CREATE UNIQUE INDEX "XhsRawOrderDetail_orderId_key" ON "XhsRawOrderDetail"("orderId");
CREATE INDEX "XhsRawOrderDetail_syncJobId_idx" ON "XhsRawOrderDetail"("syncJobId");

CREATE UNIQUE INDEX "XhsRawLiveSession_sessionId_key" ON "XhsRawLiveSession"("sessionId");
CREATE INDEX "XhsRawLiveSession_syncJobId_idx" ON "XhsRawLiveSession"("syncJobId");

CREATE UNIQUE INDEX "XhsRawLiveSessionDetail_sessionId_key" ON "XhsRawLiveSessionDetail"("sessionId");
CREATE INDEX "XhsRawLiveSessionDetail_syncJobId_idx" ON "XhsRawLiveSessionDetail"("syncJobId");

CREATE UNIQUE INDEX "XhsRawPendingSettlement_orderId_key" ON "XhsRawPendingSettlement"("orderId");
CREATE INDEX "XhsRawPendingSettlement_syncJobId_idx" ON "XhsRawPendingSettlement"("syncJobId");

CREATE UNIQUE INDEX "XhsRawSettledSettlement_orderId_key" ON "XhsRawSettledSettlement"("orderId");
CREATE INDEX "XhsRawSettledSettlement_syncJobId_idx" ON "XhsRawSettledSettlement"("syncJobId");
