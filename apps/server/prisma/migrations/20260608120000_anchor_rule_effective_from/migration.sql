-- 主播时间段规则生效时间：NULL = 历史规则（对全部历史订单生效）；非 NULL = 仅对生效时间之后的订单生效
ALTER TABLE "AnchorTimeRule" ADD COLUMN "effectiveFrom" DATETIME;

-- 2026-06-08 前创建的主播（子杰、飞云等）保留历史兼容：effectiveFrom 留空
-- 2026-06-08 及之后创建的主播规则：从规则创建时间起生效
UPDATE "AnchorTimeRule"
SET "effectiveFrom" = "createdAt"
WHERE "anchorId" IN (
  SELECT "id" FROM "Anchor"
  WHERE "createdAt" >= '2026-06-08 00:00:00'
);
