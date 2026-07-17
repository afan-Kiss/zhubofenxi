/**
 * 幂等 repair：临时主播字段/索引若缺失则补齐（不破坏已有数据）
 * SQLite：列已存在时跳过由应用层/校验脚本保证；本 migration 仅安全建索引。
 * 列本身由 20260717140000 在全新库创建。
 */
CREATE INDEX IF NOT EXISTS "AnchorDailySchedule_scheduleDate_temporaryAnchorKey_idx"
  ON "AnchorDailySchedule"("scheduleDate", "temporaryAnchorKey");
