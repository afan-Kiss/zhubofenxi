PRAGMA foreign_keys=OFF;

CREATE TABLE "XhsRawLiveSession_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveId" TEXT,
    "liveName" TEXT,
    "startTime" DATETIME,
    "endTime" DATETIME,
    "anchorName" TEXT,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

DROP TABLE "XhsRawLiveSession";

ALTER TABLE "XhsRawLiveSession_new" RENAME TO "XhsRawLiveSession";

CREATE INDEX "XhsRawLiveSession_liveId_idx" ON "XhsRawLiveSession"("liveId");
CREATE INDEX "XhsRawLiveSession_startTime_idx" ON "XhsRawLiveSession"("startTime");
CREATE INDEX "XhsRawLiveSession_anchorName_idx" ON "XhsRawLiveSession"("anchorName");

PRAGMA foreign_keys=ON;
