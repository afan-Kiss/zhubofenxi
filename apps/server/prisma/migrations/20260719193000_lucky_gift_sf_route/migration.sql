-- 福袋顺丰路由缓存（拒收/退回识别）
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfRouteStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfRouteLabel" TEXT;
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfRouteQueriedAt" DATETIME;
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfRouteError" TEXT;
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfRouteTrackingNo" TEXT;

CREATE INDEX "LuckyGiftShipment_sfRouteStatus_idx" ON "LuckyGiftShipment"("sfRouteStatus");
