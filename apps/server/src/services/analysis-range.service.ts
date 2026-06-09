import type { AnalysisRange, NormalizedOrder } from '../types/analysis'
import { formatDateTime, getMonthKey } from '../utils/time'

export function computeAnalysisRange(orders: NormalizedOrder[]): AnalysisRange | null {
  const validTimes = orders
    .map((o) => o.orderTime)
    .filter((t): t is Date => t instanceof Date && !Number.isNaN(t.getTime()))

  if (validTimes.length === 0) return null

  const startTime = new Date(Math.min(...validTimes.map((t) => t.getTime())))
  const endTime = new Date(Math.max(...validTimes.map((t) => t.getTime())))
  const monthKeys = [...new Set(validTimes.map((t) => getMonthKey(t)))]
  const isCrossMonth = monthKeys.length > 1

  const warnings: string[] = []
  if (isCrossMonth) {
    warnings.push('订单表包含多个自然月，当前按订单表实际时间范围分析')
  }

  const displayText = `${formatDateTime(startTime).slice(0, 10)} ~ ${formatDateTime(endTime).slice(0, 10)}`

  return {
    startTime,
    endTime,
    displayText,
    isCrossMonth,
    monthKeys,
    warnings,
  }
}
