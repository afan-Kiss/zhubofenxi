-- 福袋顺丰关键节点时间（拒收/退回/签收等）
ALTER TABLE "LuckyGiftShipment" ADD COLUMN "sfRouteEventAt" DATETIME;
