/**
 * 线下 GMV 计入经营业绩的生效起点（业务日，Asia/Shanghai）。
 * 判断字段：OfflineDeal.dealAt；区间 [2026-07-14 00:00:00+08:00, +∞)。
 * 不得使用 createdAt / 录入时间。
 */
export const OFFLINE_GMV_EFFECTIVE_FROM_DATE = '2026-07-14' as const

/** 缓存指纹：线下 GMV 口径版本 */
export const OFFLINE_GMV_METRICS_VERSION = 'offline-gmv-effective-2026-07-14' as const

/** 主播主数据版本（表结构 / 生效区间 / attributionMode 语义） */
export const ANCHOR_MASTER_DATA_VERSION = 'anchor-master-v2-effective-range-2026-07-15' as const

/** 主播视觉主题版本（颜色解析规则） */
export const ANCHOR_VISUAL_THEME_VERSION = 'anchor-visual-theme-v1-2026-07-15' as const

export const OFFLINE_GMV_EFFECTIVE_FROM_MS = Date.parse(
  `${OFFLINE_GMV_EFFECTIVE_FROM_DATE}T00:00:00.000+08:00`,
)

/** dealAt 是否计入经营线下 GMV（左闭） */
export function isOfflineDealAtEffectiveForGmv(dealAt: Date | number | string | null | undefined): boolean {
  if (dealAt == null) return false
  const ms =
    typeof dealAt === 'number'
      ? dealAt
      : dealAt instanceof Date
        ? dealAt.getTime()
        : Date.parse(String(dealAt))
  if (!Number.isFinite(ms)) return false
  return ms >= OFFLINE_GMV_EFFECTIVE_FROM_MS
}

/**
 * 查询区间是否应展示「线下 GMV」卡片 / 下钻。
 * 完全早于生效日 → 不展示；跨过或晚于生效日 → 展示（金额只统计生效日起）。
 */
export function rangeIncludesOfflineGmvSurface(startDate: string, endDate: string): boolean {
  const start = (startDate ?? '').trim()
  const end = (endDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false
  return end >= OFFLINE_GMV_EFFECTIVE_FROM_DATE
}

/** 查询区间与线下统计窗口的交集起始日（无交集时返回 null） */
export function offlineGmvStatsWindowForRange(
  startDate: string,
  endDate: string,
): { startDate: string; endDate: string } | null {
  const start = (startDate ?? '').trim()
  const end = (endDate ?? '').trim()
  if (!rangeIncludesOfflineGmvSurface(start, end)) return null
  const statsStart = start > OFFLINE_GMV_EFFECTIVE_FROM_DATE ? start : OFFLINE_GMV_EFFECTIVE_FROM_DATE
  if (statsStart > end) return null
  return { startDate: statsStart, endDate: end }
}
