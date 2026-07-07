export type AnchorLeaderboardRow = Record<string, unknown>

export type AnchorTrendMode = 'intraday' | 'daily'

export interface AnchorTrendPoint {
  key: string
  label: string
  value: number
  orderCount: number
  date?: string
  timeRange?: string
  scheduleRange?: string | null
  actualRange?: string | null
}

export interface AnchorTrend {
  mode: AnchorTrendMode
  metric: 'gmv'
  title: string
  subtitle?: string
  points: AnchorTrendPoint[]
}

/** @deprecated 使用 AnchorTrend */
export type AnchorCardTrend = AnchorTrend
/** @deprecated 使用 AnchorTrendPoint */
export type AnchorCardTrendPoint = AnchorTrendPoint
/** @deprecated 使用 AnchorTrendMode */
export type AnchorCardTrendMode = AnchorTrendMode

export function anchorRowTrend(row: AnchorLeaderboardRow): AnchorTrend | null {
  const raw = row.trend
  if (!raw || typeof raw !== 'object') return null
  const t = raw as AnchorTrend
  if (t.mode !== 'intraday' && t.mode !== 'daily') return null
  if (t.metric !== 'gmv') return null
  if (!Array.isArray(t.points)) return null
  return t
}

export function anchorRowNum(row: AnchorLeaderboardRow, key: string): number {
  return Number(row[key] ?? 0)
}

export function anchorRowRate(row: AnchorLeaderboardRow, key: string): number | null {
  const v = row[key]
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function anchorRowGmv(row: AnchorLeaderboardRow): number {
  const v = row.gmv ?? row.totalGmv
  return Number(v ?? 0)
}

export function anchorRowActualSignedAmount(row: AnchorLeaderboardRow): number {
  const v = row.actualSignedAmount
  return Number(v ?? 0)
}

export function anchorRowValidSales(row: AnchorLeaderboardRow): number {
  const v = row.validSalesAmount ?? row.effectiveGmv
  return Number(v ?? 0)
}

export function anchorRowSignedCount(row: AnchorLeaderboardRow): number {
  const v = row.actualSignedCount ?? row.signedOrderCount ?? row.signedCount
  return Number(v ?? 0)
}

export function anchorRowPaidCount(row: AnchorLeaderboardRow): number {
  const v = row.paidOrderCount ?? row.orderCount
  return Number(v ?? 0)
}

export function anchorRowRefundAmount(row: AnchorLeaderboardRow): number {
  const v = row.returnAmount ?? row.refundAmount
  return Number(v ?? 0)
}

export function anchorRowReturnRefundCount(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'returnRefundCount')
}

export function anchorRowReturnRefundRate(row: AnchorLeaderboardRow): number | null {
  return anchorRowRate(row, 'returnRefundRate')
}

export function anchorRowReturnCount(row: AnchorLeaderboardRow): number {
  const v = row.returnCount ?? row.refundOrderCount
  return Number(v ?? 0)
}

export function anchorRowLivePeriodText(row: AnchorLeaderboardRow): string | null {
  const attribution = normalizeLivePeriodText(row.livePeriodText)
  if (attribution) return attribution
  return normalizeLivePeriodText(row.liveTimeRange)
}

export function anchorRowActualLivePeriodText(row: AnchorLeaderboardRow): string | null {
  return normalizeLivePeriodText(row.liveTimeRange)
}

export function anchorRowAttributionLivePeriodText(row: AnchorLeaderboardRow): string | null {
  return normalizeLivePeriodText(row.livePeriodText)
}

function normalizeLivePeriodText(raw: unknown): string | null {
  const text = String(raw ?? '').trim()
  if (!text || text === '—') return null
  return text.replace(/~/g, '–')
}

function stripClockSeconds(text: string): string {
  return text.replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
}

function livePeriodComparable(text: string): string {
  return stripClockSeconds(text.replace(/\s/g, ''))
}

function livePeriodsLooselyEqual(a: string, b: string): boolean {
  const left = livePeriodComparable(a)
  const right = livePeriodComparable(b)
  return left === right || left.includes(right) || right.includes(left)
}

export function anchorRowLivePeriodHint(row: AnchorLeaderboardRow): string | null {
  const hint = String(row.livePeriodHint ?? '').trim()
  return hint || null
}

export function anchorRowScheduleTimeRange(row: AnchorLeaderboardRow): string | null {
  const raw = String(row.scheduleTimeRange ?? row.scheduledPeriodText ?? '').trim()
  if (!raw || raw === '—') return null
  return raw.replace(/~/g, '–')
}

/** 今日/昨日卡片：实际/归属/排班时段文案 */
export function anchorRowLivePeriodLines(row: AnchorLeaderboardRow): {
  primary: string | null
  secondary: string | null
} {
  const actual = anchorRowActualLivePeriodText(row)
  const attribution = anchorRowAttributionLivePeriodText(row)
  const schedule = anchorRowScheduleTimeRange(row)
  const hint = anchorRowLivePeriodHint(row)

  const scheduleSuffix =
    schedule &&
    (!attribution || !livePeriodsLooselyEqual(schedule, attribution)) &&
    (!actual || !livePeriodsLooselyEqual(schedule, actual))
      ? ` · 排班 ${schedule}`
      : ''

  if (actual && attribution && !livePeriodsLooselyEqual(actual, attribution)) {
    return { primary: `实际 ${actual} · 归属 ${attribution}${scheduleSuffix}`, secondary: null }
  }
  if (attribution) {
    return { primary: `归属 ${attribution}${scheduleSuffix}`, secondary: null }
  }
  if (actual) {
    return {
      primary: `实际 ${actual}`,
      secondary: schedule ? `排班 ${schedule}` : null,
    }
  }
  if (hint) {
    return { primary: hint, secondary: schedule ? `排班 ${schedule}` : null }
  }
  return { primary: schedule ? `排班 ${schedule}` : null, secondary: null }
}

export function isSingleDayRange(startDate: string, endDate: string): boolean {
  return startDate.trim() === endDate.trim()
}

export function isSingleDayPreset(
  preset: string,
  startDate?: string,
  endDate?: string,
): boolean {
  if (startDate?.trim() && endDate?.trim()) {
    return isSingleDayRange(startDate, endDate)
  }
  return preset === 'today' || preset === 'yesterday'
}

export function aggregateSummaryFromAnchorRows(
  rows: AnchorLeaderboardRow[],
): Record<string, unknown> {
  if (rows.length === 0) return {}
  let totalGmv = 0
  let validSalesAmount = 0
  let actualSignedAmount = 0
  let paidOrderCount = 0
  let returnCount = 0
  let returnAmount = 0
  let returnRefundCount = 0
  let qualityReturnCount = 0
  let signedCount = 0
  let actualSignedCount = 0
  for (const row of rows) {
    totalGmv += anchorRowGmv(row)
    validSalesAmount += anchorRowValidSales(row)
    actualSignedAmount += anchorRowActualSignedAmount(row)
    paidOrderCount += anchorRowPaidCount(row)
    returnCount += anchorRowReturnCount(row)
    returnAmount += anchorRowRefundAmount(row)
    returnRefundCount += anchorRowReturnRefundCount(row)
    qualityReturnCount += anchorRowNum(row, 'qualityReturnCount')
    signedCount += anchorRowNum(row, 'signedCount')
    actualSignedCount += anchorRowSignedCount(row)
  }
  const refundRate = paidOrderCount > 0 ? returnCount / paidOrderCount : null
  const signRate = paidOrderCount > 0 ? actualSignedCount / paidOrderCount : null
  return {
    totalGmv,
    gmv: totalGmv,
    validSalesAmount,
    effectiveGmv: validSalesAmount,
    actualSignedAmount,
    orderCount: paidOrderCount,
    paidOrderCount,
    returnRate: refundRate,
    refundRate,
    returnCount,
    refundOrderCount: returnCount,
    returnAmount,
    refundAmount: returnAmount,
    returnRefundCount,
    qualityReturnCount,
    signedCount,
    signedOrderCount: signedCount,
    actualSignedCount,
    signRate,
  }
}

export function isHighRefundRate(rate: number | null): boolean {
  return rate != null && rate >= 0.5
}

/** 主播业绩卡片：支付金额降序，相同时按已签收金额、姓名 */
export function sortAnchorLeaderboardByPerformance(
  rows: AnchorLeaderboardRow[],
): AnchorLeaderboardRow[] {
  return [...rows].sort((a, b) => {
    const gmvDiff = anchorRowGmv(b) - anchorRowGmv(a)
    if (gmvDiff !== 0) return gmvDiff
    const signedDiff = anchorRowActualSignedAmount(b) - anchorRowActualSignedAmount(a)
    if (signedDiff !== 0) return signedDiff
    const nameA = String(a.anchorName ?? '')
    const nameB = String(b.anchorName ?? '')
    if (nameA === '未归属' && nameB !== '未归属') return 1
    if (nameB === '未归属' && nameA !== '未归属') return -1
    return nameA.localeCompare(nameB, 'zh-CN')
  })
}
