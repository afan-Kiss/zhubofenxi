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

export type AnchorCardTrendMode = 'intraday' | 'daily'

export interface AnchorCardTrendPoint {
  key: string
  label: string
  value: number
  orderCount: number
  date?: string
  scheduleRange?: string | null
  actualRange?: string | null
}

export interface AnchorCardTrend {
  mode: AnchorCardTrendMode
  metric: 'gmv'
  points: AnchorCardTrendPoint[]
}

const INTRADAY_BUCKET_MINUTES = 30

export function resolveAnchorCardTrendMode(
  preset: string | undefined,
  startDate: string,
  endDate: string,
): AnchorCardTrendMode {
  if (preset === 'today' || preset === 'yesterday') return 'intraday'
  if (preset === 'thisWeek' || preset === 'thisMonth' || preset === 'lastMonth') return 'daily'
  if (preset === 'custom') {
    return isSingleDayRange(startDate, endDate) ? 'intraday' : 'daily'
  }
  return isSingleDayRange(startDate, endDate) ? 'intraday' : 'daily'
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

function orderGmvCent(v: AnalyzedOrderView): number {
  return v.effectiveGmvCent ?? v.gmvCent ?? 0
}

function floorToBucketMs(ms: number, bucketMinutes: number): number {
  const bucketMs = bucketMinutes * 60_000
  return Math.floor(ms / bucketMs) * bucketMs
}

function formatBucketLabel(ms: number): string {
  return formatClockShanghai(new Date(ms))
}

function formatDailyLabel(dateKey: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateKey)
  if (!m) return dateKey
  return `${Number(m[2])}/${Number(m[3])}`
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
    return `${start}–${end}`
  })
  return parts.join('\n')
}

function resolveIntradayLiveRangeMs(
  row: Record<string, unknown>,
  dateKey: string,
  anchorViews: AnalyzedOrderView[],
): { startMs: number; endMs: number } | null {
  const actualStartMs = parseLiveSessionTimeMs(String(row.actualStartAt ?? ''))
  const actualEndMs = parseLiveSessionTimeMs(String(row.actualEndAt ?? ''))
  if (actualStartMs != null && actualEndMs != null && actualEndMs > actualStartMs) {
    return { startMs: actualStartMs, endMs: actualEndMs }
  }

  const liveTimeRange = String(row.liveTimeRange ?? row.livePeriodText ?? '').trim()
  if (liveTimeRange && liveTimeRange !== '—' && liveTimeRange !== '未读取到直播场次') {
    const segments = liveTimeRange.split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
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
  }

  const paymentTimes = anchorViews
    .map((v) => parseOrderPaymentMs(v.orderTimeText))
    .filter((ms): ms is number => ms != null)
  if (paymentTimes.length === 0) return null

  const dayStart = startOfDayMsShanghai(dateKey)
  const dayEnd = dayStart + 86_400_000 - 1
  const inDay = paymentTimes.filter((ms) => ms >= dayStart && ms <= dayEnd)
  if (inDay.length === 0) return null
  return { startMs: Math.min(...inDay), endMs: Math.max(...inDay) }
}

function buildIntradayTrend(
  anchorViews: AnalyzedOrderView[],
  dateKey: string,
  row: Record<string, unknown>,
): AnchorCardTrend {
  const liveRange = resolveIntradayLiveRangeMs(row, dateKey, anchorViews)
  const scheduleRange =
    String(row.scheduledPeriodText ?? '').trim() ||
    null
  const actualRange =
    String(row.liveTimeRange ?? '').trim() &&
    String(row.liveTimeRange ?? '').trim() !== '未读取到直播场次'
      ? String(row.liveTimeRange ?? '').replace(/~/g, '–')
      : null

  if (!liveRange) {
    return { mode: 'intraday', metric: 'gmv', points: [] }
  }

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
    if (payMs < liveRange.startMs || payMs > liveRange.endMs) continue
    const bucket = floorToBucketMs(payMs, INTRADAY_BUCKET_MINUTES)
    const cur = bucketMap.get(bucket)
    if (!cur) continue
    cur.cent += orderGmvCent(v)
    cur.orders += 1
  }

  const points: AnchorCardTrendPoint[] = [...bucketMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, agg]) => ({
      key: formatBucketLabel(ms),
      label: formatBucketLabel(ms),
      value: centToYuan(agg.cent),
      orderCount: agg.orders,
      date: dateKey,
      scheduleRange,
      actualRange,
    }))

  return { mode: 'intraday', metric: 'gmv', points }
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
      const text = buildActualLivePeriodText(daySessions)
      actualRange = text && text !== '—' ? text.replace(/~/g, '–') : null
    } else if (scheduleRange) {
      const usedRowIds = new Set<string>()
      const attendance = resolveAnchorAttendanceFromSessions(
        table.rows,
        params.anchorName,
        '',
        [],
        usedRowIds,
      )
      actualRange = attendance.actualStartText && attendance.actualEndText
        ? `${attendance.actualStartText}–${attendance.actualEndText}`
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
): AnchorCardTrend {
  const days = eachDayInShanghaiRange(startDate, endDate)
  const byDate = new Map<string, { cent: number; orders: number }>()
  for (const day of days) byDate.set(day, { cent: 0, orders: 0 })

  for (const v of anchorViews) {
    const dayKey = v.orderTimeText?.trim().slice(0, 10)
    if (!dayKey || !byDate.has(dayKey)) continue
    const bucket = byDate.get(dayKey)!
    bucket.cent += orderGmvCent(v)
    bucket.orders += 1
  }

  const points: AnchorCardTrendPoint[] = days.map((day) => {
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

  return { mode: 'daily', metric: 'gmv', points }
}

export async function enrichAnchorLeaderboardWithTrend(
  rows: Array<Record<string, unknown>>,
  performanceViews: AnalyzedOrderView[],
  params: { preset?: string; startDate: string; endDate: string },
): Promise<Array<Record<string, unknown>>> {
  const mode = resolveAnchorCardTrendMode(params.preset, params.startDate, params.endDate)

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
