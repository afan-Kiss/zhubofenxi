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
  const raw = String(row.livePeriodText ?? row.liveTimeRange ?? '').trim()
  if (!raw || raw === '—') return null
  return raw.replace(/~/g, '–')
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

/** 今日/昨日卡片：直播时间 + 可选排班对照 */
export function anchorRowLivePeriodLines(row: AnchorLeaderboardRow): {
  primary: string | null
  secondary: string | null
} {
  const live = anchorRowLivePeriodText(row)
  const schedule = anchorRowScheduleTimeRange(row)
  const hint = anchorRowLivePeriodHint(row)

  if (live) {
    const secondary =
      schedule && schedule !== live
        ? `排班 ${schedule}｜实际 ${live}`
        : schedule
          ? `排班 ${schedule}`
          : null
    return { primary: `直播 ${live}`, secondary }
  }

  if (hint) {
    return { primary: hint, secondary: schedule ? `排班 ${schedule}` : null }
  }

  return { primary: null, secondary: schedule ? `排班 ${schedule}` : null }
}

export function isSingleDayPreset(preset: string): boolean {
  return preset === 'today' || preset === 'yesterday'
}

export function isHighRefundRate(rate: number | null): boolean {
  return rate != null && rate >= 0.5
}
