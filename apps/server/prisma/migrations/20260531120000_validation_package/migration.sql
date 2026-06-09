-- CreateTable
CREATE TABLE "ValidationPackage" (
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

CREATE INDEX "ValidationPackage_snapshotId_idx" ON "ValidationPackage"("snapshotId");
CREATE INDEX "ValidationPackage_status_idx" ON "ValidationPackage"("status");
CREATE INDEX "ValidationPackage_createdAt_idx" ON "ValidationPackage"("createdAt");
