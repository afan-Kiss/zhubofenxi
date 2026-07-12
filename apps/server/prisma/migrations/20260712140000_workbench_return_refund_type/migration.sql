-- AlterTable
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "hasReturnRefund" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "hasRefundOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "returnRefundCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "refundOnlyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "afterSaleType" TEXT;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "returnTypeCodes" TEXT;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "classificationSource" TEXT;

-- CreateIndex
CREATE INDEX "XhsAfterSalesWorkbenchCache_hasReturnRefund_idx" ON "XhsAfterSalesWorkbenchCache"("hasReturnRefund");
