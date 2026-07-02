import { prisma } from '../lib/prisma'
import {
  GOOD_REVIEW_SHOPS,
  getGoodReviewShopName,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import { resolveOfficialShopAccount } from './official-shop-account.service'
import {
  normalizeXhsLiveSession,
  type NormalizedLiveSession,
} from './xhs-api-sync/xhs-json-normalizer.service'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { formatDateTimeShanghai } from '../utils/business-timezone'
import {
  extractLiveSessionTrafficFromSession,
  type LiveSessionTrafficMetrics,
} from './live-session-traffic.util'
import {
  formatLiveDurationMinutes,
  type AnchorLiveSessionBrief,
} from './anchor-live-sessions.service'
import type { EffectiveScheduleRow } from './anchor-daily-schedule.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import {
  matchLiveSessionToBestScheduleRow,
  type LiveSessionScheduleMatchResult,
} from './daily-report-live-schedule-match.service'
import { anchorNamesMatch } from '../utils/anchor-name-normalize.util'

const RAW_LIVE_RANGE_DB_BUFFER_MS = 1 * 24 * 60 * 60 * 1000
const LOG_TAG = '[daily-report-live]'

export interface DailyReportLiveSession extends AnchorLiveSessionBrief, LiveSessionTrafficMetrics {
  sourceShopCode: GoodReviewShopKey
  sourceShopName: string
  sellerRealIncomeAmtYuan: number
  dealOrderCnt: number
  refundAmtYuan: number
}

export interface DailyReportLiveSessionAssignment {
  byAnchor: Map<string, DailyReportLiveSession[]>
  matchesByAnchor: Map<string, LiveSessionScheduleMatchResult[]>
  allSessions: DailyReportLiveSession[]
  totalUniqueSessionCount: number
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function normalizedToDailyReportSession(
  session: NormalizedLiveSession,
  shopKey: GoodReviewShopKey,
): DailyReportLiveSession | null {
  if (session.errors.length > 0 || !session.startTime || !session.liveId?.trim()) {
    return null
  }
  const startTime = formatDateTimeShanghai(session.startTime)
  let endTime = session.endTime ? formatDateTimeShanghai(session.endTime) : '—'
  if (session.endTime && session.startTime && session.endTime.getTime() < session.startTime.getTime()) {
    endTime = formatDateTimeShanghai(new Date(session.endTime.getTime() + 86_400_000))
  }
  const shopName = getGoodReviewShopName(shopKey)
  return {
    ...extractLiveSessionTrafficFromSession(session),
    liveId: session.liveId.trim(),
    liveName: session.liveName?.trim() || shopName,
    startTime,
    endTime,
    durationMinutes: session.durationMinutes,
    durationText: formatLiveDurationMinutes(session.durationMinutes),
    sourceShopCode: shopKey,
    sourceShopName: shopName,
    sellerRealIncomeAmtYuan: session.liveGmvCent / 100,
    dealOrderCnt: session.dealOrderCount,
    refundAmtYuan: session.refundAmountCent / 100,
  }
}

export function buildDailyReportLiveSessionDedupeKey(session: {
  sourceShopCode: GoodReviewShopKey
  liveId?: string
  startTime?: string
  endTime?: string
}): string {
  const liveId = session.liveId?.trim()
  if (liveId) return `${session.sourceShopCode}::${liveId}`
  const start = session.startTime?.trim() || ''
  const end = session.endTime?.trim() || ''
  return `${session.sourceShopCode}::${start}::${end}`
}

export function dedupeDailyReportLiveSessions(
  sessions: DailyReportLiveSession[],
): DailyReportLiveSession[] {
  const byKey = new Map<string, DailyReportLiveSession>()
  for (const session of sessions) {
    const key = buildDailyReportLiveSessionDedupeKey(session)
    const existing = byKey.get(key)
    if (!existing || session.durationMinutes > existing.durationMinutes) {
      byKey.set(key, session)
    }
  }
  return [...byKey.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
}

function logLiveSessionRow(params: {
  reportDate: string
  shopCode: GoodReviewShopKey
  shopName: string
  sellerLiveDetailDataCount: number
  session: DailyReportLiveSession
  match: LiveSessionScheduleMatchResult | null
}): void {
  const scheduleTimeRange = params.match?.scheduleRow
    ? `${params.match.scheduleRow.startTime}–${params.match.scheduleRow.endTime}`
    : null
  console.log(
    LOG_TAG,
    JSON.stringify({
      reportDate: params.reportDate,
      shopCode: params.shopCode,
      shopName: params.shopName,
      sellerLiveDetailDataCount: params.sellerLiveDetailDataCount,
      liveId: params.session.liveId,
      liveStartTime: params.session.startTime,
      liveEndTime: params.session.endTime,
      anchorName: params.match?.scheduleRow?.anchorName ?? null,
      scheduleTimeRange,
      overlapMinutes: params.match?.overlapMinutes ?? 0,
      unmatchedReason: params.match?.scheduleRow ? null : params.match?.matchReason ?? '未匹配排班',
    }),
  )
}

/** 按四店官方账号分别读取 sellerLiveDetailData 同步入库的真实直播场次 */
export async function loadPerShopDailyReportLiveSessions(params: {
  reportDate: string
  preset?: string
  startDate: string
  endDate: string
}): Promise<DailyReportLiveSession[]> {
  const range = resolveDateRange(
    (params.preset ?? 'custom') as DateRangePreset,
    params.startDate,
    params.endDate,
  )
  const collected: DailyReportLiveSession[] = []

  for (const shop of GOOD_REVIEW_SHOPS) {
    const shopName = shop.shopName
    const account = await resolveOfficialShopAccount(shop.shopKey)
    if (!account) {
      console.log(
        LOG_TAG,
        JSON.stringify({
          reportDate: params.reportDate,
          shopCode: shop.shopKey,
          shopName,
          sellerLiveDetailDataCount: 0,
          unmatchedReason: '未配置官方店铺账号',
        }),
      )
      continue
    }

    const rows = await prisma.xhsRawLiveSession.findMany({
      where: {
        liveAccountId: account.id,
        startTime: {
          gte: new Date(range.startTimeMs - RAW_LIVE_RANGE_DB_BUFFER_MS),
          lte: new Date(range.endTimeMs + RAW_LIVE_RANGE_DB_BUFFER_MS),
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const inRange: DailyReportLiveSession[] = []
    for (const row of rows) {
      const normalized = normalizeXhsLiveSession(asRecord(row.rawJson), row.id)
      const withAccount: NormalizedLiveSession = row.liveAccountName?.trim()
        ? { ...normalized, liveAccountName: row.liveAccountName.trim() }
        : normalized
      const brief = normalizedToDailyReportSession(withAccount, shop.shopKey)
      if (!brief) continue
      const startMs = new Date(brief.startTime).getTime()
      if (!Number.isFinite(startMs)) continue
      if (startMs < range.startTimeMs || startMs > range.endTimeMs) continue
      inRange.push(brief)
    }

    console.log(
      LOG_TAG,
      JSON.stringify({
        reportDate: params.reportDate,
        shopCode: shop.shopKey,
        shopName,
        sellerLiveDetailDataCount: inRange.length,
        rawRowCount: rows.length,
        liveAccountId: account.id,
      }),
    )

    collected.push(...inRange)
  }

  return dedupeDailyReportLiveSessions(collected)
}

/** 真实场次 → 排班主播（每场只归一个主播，取重叠分钟最大） */
export function assignDailyReportLiveSessionsToAnchors(
  sessions: DailyReportLiveSession[],
  scheduleRows: EffectiveScheduleRow[],
  reportDate: string,
): DailyReportLiveSessionAssignment {
  const byAnchor = new Map<string, DailyReportLiveSession[]>()
  const matchesByAnchor = new Map<string, LiveSessionScheduleMatchResult[]>()

  for (const session of sessions) {
    const match = matchLiveSessionToBestScheduleRow(session, scheduleRows)
    logLiveSessionRow({
      reportDate,
      shopCode: session.sourceShopCode,
      shopName: session.sourceShopName,
      sellerLiveDetailDataCount: sessions.filter((s) => s.sourceShopCode === session.sourceShopCode)
        .length,
      session,
      match,
    })

    if (!match.scheduleRow) continue
    const anchorName = match.scheduleRow.anchorName
    if (!byAnchor.has(anchorName)) byAnchor.set(anchorName, [])
    if (!matchesByAnchor.has(anchorName)) matchesByAnchor.set(anchorName, [])
    byAnchor.get(anchorName)!.push(session)
    matchesByAnchor.get(anchorName)!.push(match)
  }

  return {
    byAnchor,
    matchesByAnchor,
    allSessions: sessions,
    totalUniqueSessionCount: sessions.length,
  }
}

export async function loadAndAssignDailyReportLiveSessions(params: {
  reportDate: string
  preset?: string
  startDate: string
  endDate: string
  scheduleRows: EffectiveScheduleRow[]
}): Promise<DailyReportLiveSessionAssignment> {
  const sessions = await loadPerShopDailyReportLiveSessions({
    reportDate: params.reportDate,
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  return assignDailyReportLiveSessionsToAnchors(sessions, params.scheduleRows, params.reportDate)
}

export function getAssignedSessionsForAnchor(
  assignment: DailyReportLiveSessionAssignment,
  anchorName: string,
): DailyReportLiveSession[] {
  for (const [name, sessions] of assignment.byAnchor.entries()) {
    if (anchorNamesMatch(name, anchorName)) return sessions
  }
  return []
}

export function sumUniqueDailyReportLiveDurationMinutes(
  sessions: DailyReportLiveSession[],
): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, s.durationMinutes), 0)
}

/** 主播业绩/订单明细：按店真实场次 + 排班重叠归属某主播（每场只归一人） */
export async function resolveAssignedRealLiveSessionsForAnchor(params: {
  preset?: string
  startDate: string
  endDate: string
  anchorName: string
}): Promise<DailyReportLiveSession[]> {
  const anchorName = params.anchorName.trim()
  if (!anchorName || anchorName === '未归属') return []

  const sessions = await loadPerShopDailyReportLiveSessions({
    reportDate: params.startDate,
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })

  const scheduleCache = new Map<string, EffectiveScheduleRow[]>()
  const assigned: DailyReportLiveSession[] = []

  for (const session of sessions) {
    const dateKey = session.startTime.slice(0, 10)
    let scheduleRows = scheduleCache.get(dateKey)
    if (!scheduleRows) {
      const table = await getEffectiveScheduleTableForDate(dateKey)
      scheduleRows = table.rows
      scheduleCache.set(dateKey, scheduleRows)
    }
    const match = matchLiveSessionToBestScheduleRow(session, scheduleRows)
    if (match.scheduleRow && anchorNamesMatch(match.scheduleRow.anchorName, anchorName)) {
      assigned.push(session)
    }
  }

  return assigned.sort((a, b) => a.startTime.localeCompare(b.startTime))
}
