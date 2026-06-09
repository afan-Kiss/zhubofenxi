import type { BoardRangePreset } from './board-range'

function spanDaysInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
}

/** 今日/昨日/本周不展示签收率、退货率、品退率；本月与较长自定义区间展示 */
export function showLongPeriodRates(
  preset: BoardRangePreset,
  startDate?: string,
  endDate?: string,
): boolean {
  if (preset === 'today' || preset === 'yesterday' || preset === 'thisWeek') return false
  if (preset === 'thisMonth' || preset === 'lastMonth') return true
  if (preset === 'custom' && startDate && endDate) {
    return spanDaysInclusive(startDate, endDate) >= 7
  }
  return true
}

/** 主播订单抽屉：仅本周/本月/上月/自定义展示签收与品退相关汇总 */
export function showDrawerSignQualityMetrics(preset?: string): boolean {
  return (
    preset === 'thisWeek' ||
    preset === 'thisMonth' ||
    preset === 'lastMonth' ||
    preset === 'custom'
  )
}
