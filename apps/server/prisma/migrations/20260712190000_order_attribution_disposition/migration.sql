-- CreateTable
CREATE TABLE "OrderAttributionDisposition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderKey" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "anchorName" TEXT,
    "anchorId" TEXT,
    "nonLiveReason" TEXT,
    "nonLiveReasonText" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "confirmNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderAttributionDisposition_orderKey_key" ON "OrderAttributionDisposition"("orderKey");

-- CreateIndex
CREATE INDEX "OrderAttributionDisposition_disposition_idx" ON "OrderAttributionDisposition"("disposition");

-- CreateIndex
CREATE INDEX "OrderAttributionDisposition_confirmedAt_idx" ON "OrderAttributionDisposition"("confirmedAt");

-- CreateTable
CREATE TABLE "OrderAttributionDispositionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromJson" TEXT,
    "toJson" TEXT,
    "operator" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "OrderAttributionDispositionLog_orderKey_createdAt_idx" ON "OrderAttributionDispositionLog"("orderKey", "createdAt");

-- CreateIndex
CREATE INDEX "OrderAttributionDispositionLog_createdAt_idx" ON "OrderAttributionDispositionLog"("createdAt");

-- Backfill: migrate existing manual anchor overrides into disposition=anchor
INSERT INTO "OrderAttributionDisposition" (
  "id",
  "orderKey",
  "disposition",
  "anchorName",
  "anchorId",
  "nonLiveReason",
  "nonLiveReasonText",
  "confirmedBy",
  "confirmedAt",
  "confirmNote",
  "createdAt",
  "updatedAt"
)
SELECT
  'disp_' || "id",
  "orderKey",
  'anchor',
  "anchorName",
  "anchorId",
  NULL,
  NULL,
  "assignedBy",
  "updatedAt",
  NULL,
  "createdAt",
  "updatedAt"
FROM "OrderAnchorManualOverride"
WHERE NOT EXISTS (
  SELECT 1 FROM "OrderAttributionDisposition" d WHERE d."orderKey" = "OrderAnchorManualOverride"."orderKey"
);

INSERT INTO "OrderAttributionDispositionLog" (
  "id",
  "orderKey",
  "action",
  "fromJson",
  "toJson",
  "operator",
  "note",
  "createdAt"
)
SELECT
  'log_mig_' || "id",
  "orderKey",
  'migrate_manual_override',
  NULL,
  '{"disposition":"anchor","anchorName":"' || REPLACE("anchorName", '"', '') || '"}',
  COALESCE("assignedBy", 'system-migration'),
  '从 OrderAnchorManualOverride 迁移',
  "createdAt"
FROM "OrderAnchorManualOverride";
