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
  return anchorRowNum(row, 'gmv') || anchorRowNum(row, 'totalGmv')
}

export function anchorRowValidSales(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'validSalesAmount') || anchorRowNum(row, 'effectiveGmv')
}

export function anchorRowSignedCount(row: AnchorLeaderboardRow): number {
  return (
    anchorRowNum(row, 'actualSignedCount') ||
    anchorRowNum(row, 'signedOrderCount') ||
    anchorRowNum(row, 'signedCount')
  )
}

export function anchorRowPaidCount(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'paidOrderCount') || anchorRowNum(row, 'orderCount')
}

export function anchorRowRefundAmount(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'returnAmount') || anchorRowNum(row, 'refundAmount')
}

export function anchorRowReturnRefundCount(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'returnRefundCount')
}

export function anchorRowReturnRefundRate(row: AnchorLeaderboardRow): number | null {
  return anchorRowRate(row, 'returnRefundRate')
}

export function anchorRowLivePeriodText(row: AnchorLeaderboardRow): string | null {
  const attribution = normalizeLivePeriodText(row.livePeriodText)
  if (attribution) return attribution
  return normalizeLivePeriodText(row.liveTimeRange)
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

/** 今日/昨日卡片：归属直播时段；与排班不一致时合并为一行 */
export function anchorRowLivePeriodLines(row: AnchorLeaderboardRow): {
  primary: string | null
  secondary: string | null
} {
  const live = anchorRowLivePeriodText(row)
  const schedule = anchorRowScheduleTimeRange(row)
  const hint = anchorRowLivePeriodHint(row)

  if (live) {
    if (schedule && !livePeriodsLooselyEqual(schedule, live)) {
      return { primary: `直播 ${live} · 排班 ${schedule}`, secondary: null }
    }
    return { primary: `直播 ${live}`, secondary: null }
  }

  if (hint) {
    return { primary: hint, secondary: schedule ? `排班 ${schedule}` : null }
  }

  return { primary: null, secondary: schedule ? `排班 ${schedule}` : null }
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
  let actualSignedAmount = 0
  let orderCount = 0
  let returnAmount = 0
  for (const row of rows) {
    totalGmv += anchorRowGmv(row)
    actualSignedAmount += anchorRowNum(row, 'actualSignedAmount')
    orderCount += anchorRowPaidCount(row)
    returnAmount += anchorRowRefundAmount(row)
  }
  return {
    totalGmv,
    gmv: totalGmv,
    actualSignedAmount,
    orderCount,
    returnRate: totalGmv > 0 ? returnAmount / totalGmv : null,
  }
}

export function isHighRefundRate(rate: number | null): boolean {
  return rate != null && rate >= 0.5
}
