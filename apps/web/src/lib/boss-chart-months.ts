/** 老板看板月度到账趋势：裁剪开头连续无到账月份（不删中间 0 月、不造假） */

export interface BossMonthlyPoint {
  month: string
}

const DEFAULT_MAX_MONTHS = 12

function isPositiveAmount(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value > 0
}

/**
 * 1. 保留最近 maxMonths 个自然月（默认 12）
 * 2. 裁掉开头连续 amountCent === 0 或 null 的月份
 * 3. 首个有数据月之后保留所有月份（含中间 0 月、含当前 0 月）
 * 4. 若全无正数到账，返回空数组
 */
export function trimLeadingEmptyMonths<T extends BossMonthlyPoint>(
  points: T[],
  getAmountCent: (point: T) => number | null | undefined,
  maxMonths = DEFAULT_MAX_MONTHS,
): T[] {
  if (points.length === 0) return []

  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month))
  const recent = sorted.slice(-maxMonths)
  const firstDataIdx = recent.findIndex((p) => isPositiveAmount(getAmountCent(p)))

  if (firstDataIdx === -1) return []

  return recent.slice(firstDataIdx)
}
