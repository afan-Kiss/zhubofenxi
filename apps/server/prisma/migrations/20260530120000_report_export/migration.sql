-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

CREATE INDEX "ReportExport_snapshotId_idx" ON "ReportExport"("snapshotId");
CREATE INDEX "ReportExport_status_idx" ON "ReportExport"("status");
CREATE INDEX "ReportExport_createdAt_idx" ON "ReportExport"("createdAt");
