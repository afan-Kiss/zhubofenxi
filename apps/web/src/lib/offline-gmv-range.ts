/** 与后端 OFFLINE_GMV_EFFECTIVE_FROM_DATE 对齐：展示线下 GMV 卡片的区间判断 */
export const OFFLINE_GMV_EFFECTIVE_FROM_DATE = '2026-07-14'

export function rangeIncludesOfflineGmvSurface(startDate: string, endDate: string): boolean {
  const start = (startDate ?? '').trim()
  const end = (endDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false
  return end >= OFFLINE_GMV_EFFECTIVE_FROM_DATE
}
