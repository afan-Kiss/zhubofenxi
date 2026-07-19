-- 手动排班：主播请假标记（卡片/日报展示「休假」水印；不参与订单归属）
ALTER TABLE "AnchorDailySchedule" ADD COLUMN "isOnLeave" BOOLEAN NOT NULL DEFAULT false;
