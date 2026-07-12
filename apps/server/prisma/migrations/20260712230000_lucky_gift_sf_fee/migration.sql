-- AlterTable
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfMonthlyFeeCent" INTEGER;
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfFeeStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfFeeQueriedAt" DATETIME;
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfFeeError" TEXT;
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfFeeTrackingNo" TEXT;
