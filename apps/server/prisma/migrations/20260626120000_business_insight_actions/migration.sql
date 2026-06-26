-- CreateTable
CREATE TABLE "OperationsBusinessInsightAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "insightId" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityName" TEXT NOT NULL,
    "rangeStartDate" TEXT NOT NULL,
    "rangeEndDate" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "reviewResult" TEXT,
    "remindTomorrow" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationsBusinessInsightAction_insightId_rangeStartDate_rangeEndDate_scope_key" ON "OperationsBusinessInsightAction"("insightId", "rangeStartDate", "rangeEndDate", "scope");

-- CreateIndex
CREATE INDEX "OperationsBusinessInsightAction_rangeStartDate_rangeEndDate_scope_idx" ON "OperationsBusinessInsightAction"("rangeStartDate", "rangeEndDate", "scope");
