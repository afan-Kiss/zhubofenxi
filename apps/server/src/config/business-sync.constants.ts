/** 经营自动同步常量（独立模块，避免 scheduler ↔ business-sync-scheduler 循环依赖导致 interval 为 NaN） */

export const BUSINESS_SYNC_INTERVAL_MINUTES = 180

export const BUSINESS_SYNC_LOOKBACK_DAYS = 180

export const BUSINESS_SYNC_INTERVAL_MS = BUSINESS_SYNC_INTERVAL_MINUTES * 60 * 1000
