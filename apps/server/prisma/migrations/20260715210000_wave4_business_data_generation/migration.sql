-- CreateTable
CREATE TABLE "BusinessDataGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "ordersGeneration" INTEGER NOT NULL DEFAULT 1,
    "liveSessionsGeneration" INTEGER NOT NULL DEFAULT 1,
    "settlementsGeneration" INTEGER NOT NULL DEFAULT 1,
    "workbenchGeneration" INTEGER NOT NULL DEFAULT 1,
    "timeSearchGeneration" INTEGER NOT NULL DEFAULT 1,
    "scheduleGeneration" INTEGER NOT NULL DEFAULT 1,
    "manualOverrideGeneration" INTEGER NOT NULL DEFAULT 1,
    "offlineDealGeneration" INTEGER NOT NULL DEFAULT 1,
    "anchorMasterGeneration" INTEGER NOT NULL DEFAULT 1,
    "qualityGeneration" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "BusinessDataGeneration" ("id") VALUES ('default');
