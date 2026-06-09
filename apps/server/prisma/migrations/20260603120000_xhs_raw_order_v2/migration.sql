PRAGMA foreign_keys=OFF;

CREATE TABLE "XhsRawOrder_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "packageId" TEXT,
    "orderTime" DATETIME,
    "buyerId" TEXT,
    "rawJson" TEXT NOT NULL,
    "syncJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "XhsRawOrder_new" ("id", "orderId", "buyerId", "rawJson", "syncJobId", "createdAt", "updatedAt")
SELECT "id", "orderId", "buyerId", "rawJson", "syncJobId", "createdAt", "updatedAt"
FROM "XhsRawOrder";

DROP TABLE "XhsRawOrder";

ALTER TABLE "XhsRawOrder_new" RENAME TO "XhsRawOrder";

CREATE UNIQUE INDEX "XhsRawOrder_packageId_key" ON "XhsRawOrder"("packageId");
CREATE INDEX "XhsRawOrder_orderId_idx" ON "XhsRawOrder"("orderId");
CREATE INDEX "XhsRawOrder_orderTime_idx" ON "XhsRawOrder"("orderTime");

PRAGMA foreign_keys=ON;
