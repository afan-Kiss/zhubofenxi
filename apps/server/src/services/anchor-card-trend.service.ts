import type { AnalyzedOrderView } from '../types/analysis'
import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import { resolveAnchorLiveSessionsForRange } from './anchor-live-sessions.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { anchorGroupKey } from './anchor-attribution.util'
import { isSingleDayRange } from './anchor-late-enrichment.service'
import {
  buildActualLivePeriodText,
  resolveAnchorAttendanceFromSessions,
} from '../utils/anchor-attendance-status.util'
import { anchorNamesMatch } from '../utils/anchor-name-normalize.util'
import {
  formatClockShanghai,
  formatDateKeyShanghai,
  parseLiveSessionTimeMs,
  startOfDayMsShanghai,
} from '../utils/business-timezone'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import { centToYuan } from '../utils/money'

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

/** @deprecated 使用 AnchorTrendMode */
export type AnchorCardTrendMode = AnchorTrendMode
/** @deprecated 使用 AnchorTrendPoint */
export type AnchorCardTrendPoint = AnchorTrendPoint
/** @deprecated 使用 AnchorTrend */
export type AnchorCardTrend = AnchorTrend

const INTRADAY_BUCKET_MINUTES = 30
const INTRADAY_TITLE = '直播时段走势'
const DAILY_TITLE = '每日销售走势'

export function resolveAnchorTrendMode(params: {
  preset?: string
  startDate: string
  endDate: string
}): AnchorTrendMode {
  const { preset, startDate, endDate } = params
  if (preset === 'today' || preset === 'yesterday') return 'intraday'
  if (preset === 'custom') {
    return isSingleDayRange(startDate, endDate) ? 'intraday' : 'daily'
  }
  if (preset === 'thisWeek' || preset === 'thisMonth' || preset === 'lastMonth') {
    return 'daily'
  }
  return isSingleDayRange(startDate, endDate) ? 'intraday' : 'daily'
}

/** @deprecated 使用 resolveAnchorTrendMode */
export function resolveAnchorCardTrendMode(
  preset: string | undefined,
  startDate: string,
  endDate: string,
): AnchorTrendMode {
  return resolveAnchorTrendMode({ preset, startDate, endDate })
}

function rowAnchorKey(row: Record<string, unknown>): string {
  const name = String(row.anchorName ?? '').trim() || '未归属'
  if (name === '未归属') return '未归属'
  const id = String(row.anchorId ?? '').trim()
  if (id && id !== name && !id.startsWith('extra-')) return `id:${id}`
  return `name:${name}`
}

function parseOrderPaymentMs(orderTimeText: string): number | null {
  return parseLiveSessionTimeMs(orderTimeText?.trim())
}

/** 与主播卡片「本期销售额」一致：paymentBaseCent → 元 */
function orderGmvCent(v: AnalyzedOrderView): number {
  return v.paymentBaseCent ?? 0
}

function floorToBucketMs(ms: number, bucketMinutes: number): number {
  const bucketMs = bucketMinutes * 60_000
  return Math.floor(ms / bucketMs) * bucketMs
}

function formatBucketLabel(ms: number): string {
  return formatClockShanghai(new Date(ms))
}

function formatBucketTimeRange(ms: number, bucketMinutes: number): string {
  const endMs = ms + bucketMinutes * 60_000
  return `${formatClockShanghai(new Date(ms))}-${formatClockShanghai(new Date(endMs))}`
}

function formatDailyLabel(dateKey: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateKey)
  if (!m) return dateKey
  return `${Number(m[2])}/${Number(m[3])}`
}

function formatRangeSegments(parts: string[]): string | null {
  if (parts.length === 0) return null
  return parts.join('；')
}

function parseClockRangeSegments(
  text: string,
  dateKey: string,
): { startMs: number; endMs: number } | null {
  const segments = text.split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
  let minStart: number | null = null
  let maxEnd: number | null = null
  for (const seg of segments) {
    const m = /(\d{1,2}:\d{2})\s*[~–-]\s*(\d{1,2}:\d{2})/.exec(seg)
    if (!m) continue
    const startMs = parseLiveSessionTimeMs(`${dateKey} ${m[1]}:00`)
    let endMs = parseLiveSessionTimeMs(`${dateKey} ${m[2]}:00`)
    if (startMs == null || endMs == null) continue
    if (endMs <= startMs) endMs += 86_400_000
    if (minStart == null || startMs < minStart) minStart = startMs
    if (maxEnd == null || endMs > maxEnd) maxEnd = endMs
  }
  if (minStart != null && maxEnd != null && maxEnd > minStart) {
    return { startMs: minStart, endMs: maxEnd }
  }
  return null
}

function resolveSchedulePeriodText(
  scheduleRows: Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>['rows'],
  anchorName: string,
): string | null {
  const matched = scheduleRows.filter(
    (r) => r.enabled && anchorNamesMatch(r.anchorName, anchorName),
  )
  if (matched.length === 0) return null
  const parts = matched.map((r) => {
    const start = formatClockShanghai(new Date(r.startAt))
    const end = formatClockShanghai(new Date(r.endAt))
    return `${start}-${end}`
  })
  return formatRangeSegments(parts)
}

function resolveIntradayDisplayRanges(row: Record<string, unknown>): {
  scheduleRange: string | null
  actualRange: string | null
} {
  const scheduleRange = String(row.scheduledPeriodText ?? '').trim().replace(/~/g, '-').replace(/–/g, '-') || null
  const liveRaw = String(row.liveTimeRange ?? row.livePeriodText ?? '').trim()
  const actualRange =
    liveRaw && liveRaw !== '—' && liveRaw !== '未读取到直播场次'
      ? liveRaw.replace(/~/g, '-').replace(/–/g, '-').replace(/\n/g, '；')
      : null
  return { scheduleRange, actualRange }
}

function resolveIntradayBaseRangeMs(
  row: Record<string, unknown>,
  dateKey: string,
  anchorViews: AnalyzedOrderView[],
): { startMs: number; endMs: number } {
  const actualStartMs = parseLiveSessionTimeMs(String(row.actualStartAt ?? ''))
  const actualEndMs = parseLiveSessionTimeMs(String(row.actualEndAt ?? ''))
  if (actualStartMs != null && actualEndMs != null && actualEndMs > actualStartMs) {
    return { startMs: actualStartMs, endMs: actualEndMs }
  }

  const scheduledStartMs = parseLiveSessionTimeMs(String(row.scheduledStartAt ?? ''))
  const scheduledEndMs = parseLiveSessionTimeMs(String(row.scheduledEndAt ?? ''))
  if (scheduledStartMs != null && scheduledEndMs != null && scheduledEndMs > scheduledStartMs) {
    return { startMs: scheduledStartMs, endMs: scheduledEndMs }
  }

  const scheduleText = String(row.scheduledPeriodText ?? '').trim()
  if (scheduleText) {
    const parsed = parseClockRangeSegments(scheduleText.replace(/~/g, '–'), dateKey)
    if (parsed) return parsed
  }

  const liveText = String(row.liveTimeRange ?? row.livePeriodText ?? '').trim()
  if (liveText && liveText !== '—' && liveText !== '未读取到直播场次') {
    const parsed = parseClockRangeSegments(liveText, dateKey)
    if (parsed) return parsed
  }

  const paymentTimes = anchorViews
    .map((v) => parseOrderPaymentMs(v.orderTimeText))
    .filter((ms): ms is number => ms != null)
  if (paymentTimes.length > 0) {
    const dayStart = startOfDayMsShanghai(dateKey)
    const dayEnd = dayStart + 86_400_000 - 1
    const inDay = paymentTimes.filter((ms) => ms >= dayStart && ms <= dayEnd)
    if (inDay.length > 0) {
      return { startMs: Math.min(...inDay), endMs: Math.max(...inDay) }
    }
  }

  const dayStart = startOfDayMsShanghai(dateKey)
  const defaultStart = parseLiveSessionTimeMs(`${dateKey} 09:00:00`) ?? dayStart + 9 * 3_600_000
  const defaultEnd = parseLiveSessionTimeMs(`${dateKey} 23:59:00`) ?? dayStart + 23 * 3_600_000 + 59 * 60_000
  return { startMs: defaultStart, endMs: defaultEnd }
}

function expandRangeToCoverOrders(
  range: { startMs: number; endMs: number },
  anchorViews: AnalyzedOrderView[],
  dateKey: string,
): { startMs: number; endMs: number } {
  const dayStart = startOfDayMsShanghai(dateKey)
  const dayEnd = dayStart + 86_400_000 - 1
  let startMs = range.startMs
  let endMs = range.endMs

  for (const v of anchorViews) {
    const payMs = parseOrderPaymentMs(v.orderTimeText)
    if (payMs == null || payMs < dayStart || payMs > dayEnd) continue
    if (payMs < startMs) startMs = payMs
    if (payMs > endMs) endMs = payMs
  }

  return { startMs, endMs }
}

function buildIntradayTrend(
  anchorViews: AnalyzedOrderView[],
  dateKey: string,
  row: Record<string, unknown>,
): AnchorTrend {
  const { scheduleRange, actualRange } = resolveIntradayDisplayRanges(row)
  const baseRange = resolveIntradayBaseRangeMs(row, dateKey, anchorViews)
  const liveRange = expandRangeToCoverOrders(baseRange, anchorViews, dateKey)

  const bucketMs = INTRADAY_BUCKET_MINUTES * 60_000
  const rangeStart = floorToBucketMs(liveRange.startMs, INTRADAY_BUCKET_MINUTES)
  const rangeEnd = floorToBucketMs(liveRange.endMs, INTRADAY_BUCKET_MINUTES) + bucketMs

  const bucketMap = new Map<number, { cent: number; orders: number }>()
  for (let t = rangeStart; t < rangeEnd; t += bucketMs) {
    bucketMap.set(t, { cent: 0, orders: 0 })
  }

  for (const v of anchorViews) {
    const payMs = parseOrderPaymentMs(v.orderTimeText)
    if (payMs == null) continue
    const bucket = floorToBucketMs(payMs, INTRADAY_BUCKET_MINUTES)
    const cur = bucketMap.get(bucket)
    if (!cur) continue
    cur.cent += orderGmvCent(v)
    cur.orders += 1
  }

  const points: AnchorTrendPoint[] = [...bucketMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, agg]) => ({
      key: String(ms),
      label: formatBucketLabel(ms),
      value: centToYuan(agg.cent),
      orderCount: agg.orders,
      date: dateKey,
      timeRange: formatBucketTimeRange(ms, INTRADAY_BUCKET_MINUTES),
      scheduleRange,
      actualRange,
    }))

  return { mode: 'intraday', metric: 'gmv', title: INTRADAY_TITLE, points }
}

async function buildDailySessionInfoByDate(params: {
  anchorName: string
  anchorId: string
  startDate: string
  endDate: string
}): Promise<Map<string, { scheduleRange: string | null; actualRange: string | null }>> {
  const days = eachDayInShanghaiRange(params.startDate, params.endDate)
  const result = new Map<string, { scheduleRange: string | null; actualRange: string | null }>()

  const sessions = await resolveAnchorLiveSessionsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    anchorId: params.anchorId,
    anchorName: params.anchorName,
  })

  const sessionsByDay = new Map<string, AnchorLiveSessionBrief[]>()
  for (const session of sessions) {
    const startMs = parseLiveSessionTimeMs(session.startTime)
    if (startMs == null) continue
    const dayKey = formatDateKeyShanghai(new Date(startMs))
    const list = sessionsByDay.get(dayKey) ?? []
    list.push(session)
    sessionsByDay.set(dayKey, list)
  }

  const scheduleTables = await Promise.all(
    days.map(async (day) => ({
      day,
      table: await getEffectiveScheduleTableForDate(day),
    })),
  )

  for (const { day, table } of scheduleTables) {
    const daySessions = sessionsByDay.get(day) ?? []
    const scheduleRange = resolveSchedulePeriodText(table.rows, params.anchorName)
    let actualRange: string | null = null
    if (daySessions.length > 0) {
      // 多场直播：各场时段用分号拼接；若需合并为最早~最晚可改此处
      const text = buildActualLivePeriodText(daySessions)
      actualRange =
        text && text !== '—'
          ? text.replace(/~/g, '-').replace(/–/g, '-').replace(/\n/g, '；')
          : null
    }
    result.set(day, { scheduleRange, actualRange })
  }

  return result
}

function buildDailyTrendFromViews(
  anchorViews: AnalyzedOrderView[],
  startDate: string,
  endDate: string,
  sessionInfoByDate: Map<string, { scheduleRange: string | null; actualRange: string | null }>,
): AnchorTrend {
  const days = eachDayInShanghaiRange(startDate, endDate)
  const byDate = new Map<string, { cent: number; orders: number }>()
  for (const day of days) byDate.set(day, { cent: 0, orders: 0 })

  for (const v of anchorViews) {
    const payMs = parseOrderPaymentMs(v.orderTimeText)
    if (payMs == null) continue
    const dayKey = formatDateKeyShanghai(new Date(payMs))
    if (!byDate.has(dayKey)) continue
    const bucket = byDate.get(dayKey)!
    bucket.cent += orderGmvCent(v)
    bucket.orders += 1
  }

  const points: AnchorTrendPoint[] = days.map((day) => {
    const agg = byDate.get(day) ?? { cent: 0, orders: 0 }
    const sessionInfo = sessionInfoByDate.get(day)
    return {
      key: day,
      label: formatDailyLabel(day),
      value: centToYuan(agg.cent),
      orderCount: agg.orders,
      date: day,
      scheduleRange: sessionInfo?.scheduleRange ?? null,
      actualRange: sessionInfo?.actualRange ?? null,
    }
  })

  return { mode: 'daily', metric: 'gmv', title: DAILY_TITLE, points }
}

export async function enrichAnchorLeaderboardWithTrend(
  rows: Array<Record<string, unknown>>,
  performanceViews: AnalyzedOrderView[],
  params: { preset?: string; startDate: string; endDate: string },
): Promise<Array<Record<string, unknown>>> {
  const mode = resolveAnchorTrendMode(params)

  const viewsByAnchor = new Map<string, AnalyzedOrderView[]>()
  for (const v of performanceViews) {
    const key = anchorGroupKey(v)
    const list = viewsByAnchor.get(key) ?? []
    list.push(v)
    viewsByAnchor.set(key, list)
  }

  if (mode === 'intraday') {
    const dateKey = params.startDate
    return rows.map((row) => {
      const key = rowAnchorKey(row)
      const anchorViews = viewsByAnchor.get(key) ?? []
      const trend = buildIntradayTrend(anchorViews, dateKey, row)
      return { ...row, trend }
    })
  }

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const anchorName = String(row.anchorName ?? '').trim()
      const anchorId = String(row.anchorId ?? '').trim()
      const key = rowAnchorKey(row)
      const anchorViews = viewsByAnchor.get(key) ?? []

      if (!anchorName || anchorName === '未归属') {
        const trend = buildDailyTrendFromViews(
          anchorViews,
          params.startDate,
          params.endDate,
          new Map(),
        )
        return { ...row, trend }
      }

      const sessionInfoByDate = await buildDailySessionInfoByDate({
        anchorName,
        anchorId,
        startDate: params.startDate,
        endDate: params.endDate,
      })
      const trend = buildDailyTrendFromViews(
        anchorViews,
        params.startDate,
        params.endDate,
        sessionInfoByDate,
      )
      return { ...row, trend }
    }),
  )

  return enriched
}
