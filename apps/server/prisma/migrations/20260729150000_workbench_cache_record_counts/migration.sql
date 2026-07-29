-- AlterTable XhsAfterSalesWorkbenchCache：售后记录数量持久化
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "matchedRecordCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "processingRecordCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "completedRecordCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "rejectedRecordCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "canceledRecordCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "closedRecordCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "unknownRecordCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsAfterSalesWorkbenchCache" ADD COLUMN "recordLifecycleSummary" TEXT;
