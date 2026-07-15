/**
 * 缓存指纹用版本常量（独立模块，避免 business-cache ↔ attribution 循环依赖）
 */
import {
  ANCHOR_MASTER_DATA_VERSION,
  OFFLINE_GMV_METRICS_VERSION,
} from '../config/offline-gmv.constants'
import { AFTER_SALES_METRICS_VERSION } from './workbench-cache-validity.service'

/** 与 canonical-order-attribution.service 保持同步 */
export const CANONICAL_ATTRIBUTION_VERSION = 'canonical-v4-manual-schedule-2026-07-14'

export const BUSINESS_CACHE_FINGERPRINT = [
  CANONICAL_ATTRIBUTION_VERSION,
  OFFLINE_GMV_METRICS_VERSION,
  ANCHOR_MASTER_DATA_VERSION,
  AFTER_SALES_METRICS_VERSION,
].join('+')
