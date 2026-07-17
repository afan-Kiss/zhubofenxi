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
import { buildShopLiveSessionWhere } from './xhs-api-sync/xhs-live-session-query.util'
import {
  endOfDayMsShanghai,
  formatDateTimeShanghai,
  parseLiveSessionTimeMs,
  startOfDayMsShanghai,
} from '../utils/business-timezone'
import {
  extractLiveSessionTrafficFromSession,
  type LiveSessionTrafficMetrics,
} from './live-session-traffic.util'
import {
  formatLiveDurationMinutes,
  type AnchorLiveSessionBrief,
} from './anchor-live-sessions.service'
import type { EffectiveScheduleRow, EffectiveScheduleSource } from './anchor-daily-schedule.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import {
  clipLiveSessionToScheduleOverlap,
  listSessionScheduleMatchCandidates,
  matchLiveSessionToScheduleSegments,
  type LiveSessionScheduleMatchResult,
  type LiveSessionScheduleSegment,
} from './daily-report-live-schedule-match.service'
import { dedupeOverlappingLiveSessionsByShopDay } from './live-session-overlap-dedupe.util'
import { anchorNamesMatch } from '../utils/anchor-name-normalize.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { addDaysShanghai } from '../utils/business-timezone'
import { isReportDateOnOrAfterShopSessionCutoff } from './anchor-performance-attribution.service'

/** 6.13 起：单日或多日 custom 范围均走「按店真实场次 + 排班重叠」（与日报一致） */
export function shouldUsePerShopRealLiveSessions(startDate: string, endDate: string): boolean {
  const start = startDate.trim()
  const end = endDate.trim()
  if (!start || !end || start > end) return false
  return (
    isReportDateOnOrAfterShopSessionCutoff(start) &&
    isReportDateOnOrAfterShopSessionCutoff(end)
  )
}

const RAW_LIVE_RANGE_DB_BUFFER_MS = 1 * 24 * 60 * 60 * 1000
const LOG_TAG = '[daily-report-live]'

export interface DailyReportLiveSession extends AnchorLiveSessionBrief, LiveSessionTrafficMetrics {
  sourceShopCode: GoodReviewShopKey
  sourceShopName: string
  liveAccountName: string
  sellerRealIncomeAmtYuan: number
  dealOrderCnt: number
  refundAmtYuan: number
  rawJson?: Record<string, unknown>
}

export interface DailyReportLiveSessionDebugRow {
  sourceShopCode: GoodReviewShopKey
  sourceShopName: string
  liveId: string
  liveAccountName: string
  liveRoomName: string
  actualStartAt: string
  actualEndAt: string
  durationMinutes: number
  matchedAnchorName: string | null
  matchedScheduleRowId: string | null
  matchedScheduleSource: EffectiveScheduleSource | null
  matchedScheduleTimeRange: string | null
  overlapMinutes: number
  skipReason: string | null
  clippedStartAt: string | null
  clippedEndAt: string | null
  clippedDurationMinutes: number | null
  scheduleCandidates: ReturnType<typeof listSessionScheduleMatchCandidates>
}

export interface DailyReportLiveSessionAssignments {
  dateKey: string
  effectiveSchedules: EffectiveScheduleRow[]
  allSessions: DailyReportLiveSession[]
  assignedSessions: DailyReportLiveSession[]
  unassignedSessions: DailyReportLiveSession[]
  byAnchor: Map<string, DailyReportLiveSession[]>
  matchesByAnchor: Map<string, LiveSessionScheduleMatchResult[]>
  debugRows: DailyReportLiveSessionDebugRow[]
  totalUniqueSessionCount: number
  assignedLiveDurationMinutes: number
  unassignedLiveDurationMinutes: number
  unassignedLiveSessionCount: number
}

export interface DailyReportLiveSessionAssignment {
  byAnchor: Map<string, DailyReportLiveSession[]>
  matchesByAnchor: Map<string, LiveSessionScheduleMatchResult[]>
  allSessions: DailyReportLiveSession[]
  totalUniqueSessionCount: number
  assignedSessions: DailyReportLiveSession[]
  unassignedSessions: DailyReportLiveSession[]
  assignedLiveDurationMinutes: number
  unassignedLiveDurationMinutes: number
  unassignedLiveSessionCount: number
  debugRows: DailyReportLiveSessionDebugRow[]
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
  rawJson?: Record<string, unknown>,
  liveAccountName?: string,
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
  const accountName = liveAccountName?.trim() || session.liveAccountName?.trim() || shopName
  return {
    ...extractLiveSessionTrafficFromSession(session),
    liveId: session.liveId.trim(),
    liveName: shopName,
    liveAccountName: accountName,
    startTime,
    endTime,
    durationMinutes: session.durationMinutes,
    durationText: formatLiveDurationMinutes(session.durationMinutes),
    sourceShopCode: shopKey,
    sourceShopName: shopName,
    sellerRealIncomeAmtYuan: session.liveGmvCent / 100,
    dealOrderCnt: session.dealOrderCount,
    refundAmtYuan: session.refundAmountCent / 100,
    rawJson,
  }
}

function sessionCompletenessScore(session: DailyReportLiveSession): number {
  let score = 0
  if (session.endTime && session.endTime !== '—') score += 2
  if (session.viewSessionCount != null) score += 1
  if (session.joinUserCount != null) score += 1
  if (session.newFollowerCount != null) score += 1
  return score
}

function pickPreferredDailyReportSession(
  existing: DailyReportLiveSession,
  candidate: DailyReportLiveSession,
): DailyReportLiveSession {
  if (candidate.durationMinutes !== existing.durationMinutes) {
    return candidate.durationMinutes > existing.durationMinutes ? candidate : existing
  }
  return sessionCompletenessScore(candidate) > sessionCompletenessScore(existing)
    ? candidate
    : existing
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
    if (!existing || pickPreferredDailyReportSession(existing, session) === session) {
      byKey.set(key, session)
    }
  }
  return dedupeOverlappingLiveSessionsByShopDay(
    [...byKey.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)),
  )
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

/** 按四店官方账号分别读取 sellerLiveDetailData 同步入库的真实直播场次（preset 固定 custom） */
export async function loadPerShopDailyReportLiveSessions(params: {
  reportDate: string
  startDate: string
  endDate: string
}): Promise<DailyReportLiveSession[]> {
  // 归属链路按业务日读场次：不得走 resolveDateRange 的「结束日截到今天」，
  // 否则 dateKey > today 时会出现 start>end 直接抛错。
  const startTimeMs = startOfDayMsShanghai(params.startDate)
  const endTimeMs = endOfDayMsShanghai(params.endDate)
  if (params.startDate > params.endDate) {
    throw new Error('开始日期不能晚于结束日期')
  }
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
      where: buildShopLiveSessionWhere({
        officialAccountId: account.id,
        shopKey: shop.shopKey,
        shopName,
        startTimeGte: new Date(startTimeMs - RAW_LIVE_RANGE_DB_BUFFER_MS),
        startTimeLte: new Date(endTimeMs + RAW_LIVE_RANGE_DB_BUFFER_MS),
      }),
      orderBy: { updatedAt: 'desc' },
    })

    const inRange: DailyReportLiveSession[] = []
    for (const row of rows) {
      const rawJson = asRecord(row.rawJson)
      const normalized = normalizeXhsLiveSession(rawJson, row.id)
      const withAccount: NormalizedLiveSession = row.liveAccountName?.trim()
        ? { ...normalized, liveAccountName: row.liveAccountName.trim() }
        : normalized
      const brief = normalizedToDailyReportSession(
        withAccount,
        shop.shopKey,
        rawJson,
        row.liveAccountName?.trim(),
      )
      if (!brief) continue
      const startMs = parseLiveSessionTimeMs(brief.startTime)
      if (startMs == null) continue
      if (startMs < startTimeMs || startMs > endTimeMs) continue
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

function toDebugRow(
  session: DailyReportLiveSession,
  segment: LiveSessionScheduleSegment | null,
  scheduleRows: EffectiveScheduleRow[],
): DailyReportLiveSessionDebugRow {
  const scheduleRow = segment?.scheduleRow ?? null
  return {
    sourceShopCode: session.sourceShopCode,
    sourceShopName: session.sourceShopName,
    liveId: session.liveId,
    liveAccountName: session.liveAccountName,
    liveRoomName: session.sourceShopName,
    actualStartAt: session.startTime,
    actualEndAt: session.endTime,
    durationMinutes: session.durationMinutes,
    matchedAnchorName: scheduleRow?.anchorName ?? null,
    matchedScheduleRowId: scheduleRow?.rowId ?? null,
    matchedScheduleSource: scheduleRow?.source ?? null,
    matchedScheduleTimeRange: scheduleRow
      ? `${scheduleRow.startTime}–${scheduleRow.endTime}`
      : null,
    overlapMinutes: segment?.overlapMinutes ?? 0,
    skipReason: segment ? null : '未匹配排班',
    clippedStartAt: segment?.clippedStartTime ?? null,
    clippedEndAt: segment?.clippedEndTime ?? null,
    clippedDurationMinutes: segment?.clippedDurationMinutes ?? null,
    scheduleCandidates: listSessionScheduleMatchCandidates(session, scheduleRows),
  }
}

function segmentToClippedSession(segment: LiveSessionScheduleSegment): DailyReportLiveSession {
  return clipLiveSessionToScheduleOverlap(
    segment.originalSession,
    segment.clippedStartMs,
    segment.clippedEndMs,
    segment.scheduleRow.rowId,
  ) as DailyReportLiveSession
}

function segmentToMatchResult(
  segment: LiveSessionScheduleSegment,
  clipped: DailyReportLiveSession,
): LiveSessionScheduleMatchResult {
  return {
    session: clipped,
    scheduleRow: segment.scheduleRow,
    overlapMinutes: segment.overlapMinutes,
    matchTier: 1,
    matchReason: segment.matchReason,
  }
}

function dedupeScheduleSegmentsForAnchor(
  segments: LiveSessionScheduleSegment[],
): LiveSessionScheduleSegment[] {
  const seen = new Set<string>()
  const kept: LiveSessionScheduleSegment[] = []
  for (const seg of segments) {
    const key = `${seg.originalSession.liveId}::${seg.clippedStartMs}::${seg.clippedEndMs}::${seg.scheduleRow.rowId}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(seg)
  }
  return kept.sort(
    (a, b) =>
      a.clippedStartMs - b.clippedStartMs ||
      b.overlapMinutes - a.overlapMinutes ||
      a.originalSession.liveId.localeCompare(b.originalSession.liveId),
  )
}

/** 真实场次按排班交集切段归属：同一主播可保留多场不重叠直播 */
function assignDailyReportLiveSessionsByScheduleSegments(params: {
  sessions: DailyReportLiveSession[]
  scheduleRows: EffectiveScheduleRow[]
  reportDate: string
}): Omit<DailyReportLiveSessionAssignment, 'allSessions' | 'totalUniqueSessionCount'> & {
  allSessions: DailyReportLiveSession[]
  totalUniqueSessionCount: number
} {
  const { sessions, scheduleRows, reportDate } = params
  const byAnchor = new Map<string, DailyReportLiveSession[]>()
  const matchesByAnchor = new Map<string, LiveSessionScheduleMatchResult[]>()
  const assignedSessions: DailyReportLiveSession[] = []
  const unassignedSessions: DailyReportLiveSession[] = []
  const debugRows: DailyReportLiveSessionDebugRow[] = []

  const segmentsByAnchor = new Map<string, LiveSessionScheduleSegment[]>()

  for (const session of sessions) {
    const segments = matchLiveSessionToScheduleSegments(session, scheduleRows)
    if (segments.length === 0) {
      unassignedSessions.push(session)
      debugRows.push(toDebugRow(session, null, scheduleRows))
      logLiveSessionRow({
        reportDate,
        shopCode: session.sourceShopCode,
        shopName: session.sourceShopName,
        sellerLiveDetailDataCount: sessions.filter((s) => s.sourceShopCode === session.sourceShopCode)
          .length,
        session,
        match: {
          session,
          scheduleRow: null,
          overlapMinutes: 0,
          matchTier: null,
          matchReason: '未匹配排班',
        },
      })
      continue
    }

    for (const segment of segments) {
      const anchorName = segment.anchorName.trim()
      if (!segmentsByAnchor.has(anchorName)) segmentsByAnchor.set(anchorName, [])
      segmentsByAnchor.get(anchorName)!.push(segment)
      debugRows.push(toDebugRow(session, segment, scheduleRows))
    }
  }

  for (const [anchorName, segments] of segmentsByAnchor) {
    const kept = dedupeScheduleSegmentsForAnchor(segments)
    if (kept.length > 1) {
      console.warn(
        LOG_TAG,
        JSON.stringify({
          reportDate,
          reason: 'multiple_sessions_for_anchor_keep_all',
          anchorName,
          count: kept.length,
          segments: kept.map((s) => ({
            liveId: s.originalSession.liveId,
            clipped: `${s.clippedStartTime}~${s.clippedEndTime}`,
            overlapMinutes: s.overlapMinutes,
          })),
        }),
      )
    }

    const clippedSessions: DailyReportLiveSession[] = []
    const matches: LiveSessionScheduleMatchResult[] = []
    for (const segment of kept) {
      const clipped = segmentToClippedSession(segment)
      const match = segmentToMatchResult(segment, clipped)

      logLiveSessionRow({
        reportDate,
        shopCode: clipped.sourceShopCode,
        shopName: clipped.sourceShopName,
        sellerLiveDetailDataCount: sessions.filter((s) => s.sourceShopCode === clipped.sourceShopCode)
          .length,
        session: clipped,
        match,
      })

      assignedSessions.push(clipped)
      clippedSessions.push(clipped)
      matches.push(match)
    }
    byAnchor.set(anchorName, clippedSessions)
    matchesByAnchor.set(anchorName, matches)
  }

  return {
    byAnchor,
    matchesByAnchor,
    allSessions: sessions,
    totalUniqueSessionCount: sessions.length,
    assignedSessions,
    unassignedSessions,
    assignedLiveDurationMinutes: sumUniqueDailyReportLiveDurationMinutes(assignedSessions),
    unassignedLiveDurationMinutes: sumUniqueDailyReportLiveDurationMinutes(unassignedSessions),
    unassignedLiveSessionCount: unassignedSessions.length,
    debugRows,
  }
}

/** 日报直播场次统一归属：只读 xhsRawLiveSession + 当日 effective schedule */
export async function resolveDailyReportLiveSessionAssignments(
  dateKey: string,
): Promise<DailyReportLiveSessionAssignments> {
  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  const scheduleRows = scheduleTable.rows
  const allSessions = await loadPerShopDailyReportLiveSessions({
    reportDate: dateKey,
    startDate: dateKey,
    endDate: dateKey,
  })

  const assignment = assignDailyReportLiveSessionsByScheduleSegments({
    sessions: allSessions,
    scheduleRows,
    reportDate: dateKey,
  })

  return {
    dateKey,
    effectiveSchedules: scheduleRows,
    ...assignment,
  }
}

/** 真实场次 → 排班主播（按排班交集切段，同主播可保留多场） */
export function assignDailyReportLiveSessionsToAnchors(
  sessions: DailyReportLiveSession[],
  scheduleRows: EffectiveScheduleRow[],
  reportDate: string,
): DailyReportLiveSessionAssignment {
  return assignDailyReportLiveSessionsByScheduleSegments({
    sessions,
    scheduleRows,
    reportDate,
  })
}

export async function loadAndAssignDailyReportLiveSessions(params: {
  reportDate: string
  startDate: string
  endDate: string
  scheduleRows: EffectiveScheduleRow[]
}): Promise<DailyReportLiveSessionAssignment> {
  // 运营日报打开时补齐大屏字段（按 reportDate；区间扫天交给同步/回填）
  try {
    const { ensureLiveRealtimeMetricsForReportDate } = await import(
      './xhs-api-sync/xhs-live-realtime-metric.service'
    )
    await ensureLiveRealtimeMetricsForReportDate(params.reportDate)
  } catch (err) {
    console.warn(
      '[daily-report-live-sessions] realtime metric ensure failed',
      err instanceof Error ? err.message : String(err),
    )
  }

  const sessions = await loadPerShopDailyReportLiveSessions({
    reportDate: params.reportDate,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  return assignDailyReportLiveSessionsToAnchors(sessions, params.scheduleRows, params.reportDate)
}

export function getAssignedSessionsForAnchor(
  assignment: Pick<DailyReportLiveSessionAssignment, 'byAnchor'>,
  anchorName: string,
): DailyReportLiveSession[] {
  for (const [name, sessions] of assignment.byAnchor.entries()) {
    if (anchorNamesMatch(name, anchorName)) return sessions
  }
  return []
}

function baseLiveIdFromClippedSession(liveId: string): string {
  const marker = '::seg::'
  const idx = liveId.indexOf(marker)
  return idx >= 0 ? liveId.slice(0, idx) : liveId
}

/** 抽屉展示：平台原始场次 + 该主播归属时段 */
export interface AnchorDrillLiveSession extends DailyReportLiveSession {
  assignedStartTime?: string
  assignedEndTime?: string
}

/** 从归属结果映射平台原始场次（含 assigned 时段） */
export function mapOriginalSessionsWithAssignedRange(
  assignment: Pick<DailyReportLiveSessionAssignments, 'allSessions' | 'byAnchor'>,
  anchorName: string,
): AnchorDrillLiveSession[] {
  const clipped = getAssignedSessionsForAnchor(assignment, anchorName)
  if (clipped.length === 0) return []

  const originalsByLiveId = new Map<string, DailyReportLiveSession>()
  for (const session of assignment.allSessions) {
    originalsByLiveId.set(session.liveId, session)
  }

  const seen = new Set<string>()
  const result: AnchorDrillLiveSession[] = []
  for (const clippedSession of clipped) {
    const baseId = baseLiveIdFromClippedSession(clippedSession.liveId)
    const original = originalsByLiveId.get(baseId)
    if (!original) continue
    const dedupeKey = `${original.sourceShopCode}::${baseId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    result.push({
      ...original,
      assignedStartTime: clippedSession.startTime,
      assignedEndTime: clippedSession.endTime,
    })
  }
  return result.sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** @deprecated 使用 mapOriginalSessionsWithAssignedRange */
export function resolveOriginalSessionsForAssignedAnchor(
  assignment: Pick<DailyReportLiveSessionAssignments, 'allSessions' | 'byAnchor'>,
  anchorName: string,
): DailyReportLiveSession[] {
  return mapOriginalSessionsWithAssignedRange(assignment, anchorName)
}

/** 主播订单抽屉：返回平台原始直播场次（订单归属仍用 clipped 段） */
export async function resolveOriginalSessionsForAssignedAnchorRange(params: {
  startDate: string
  endDate: string
  anchorName: string
}): Promise<AnchorDrillLiveSession[]> {
  const anchorName = params.anchorName.trim()
  if (!anchorName || anchorName === '未归属') return []
  if (!shouldUsePerShopRealLiveSessions(params.startDate, params.endDate)) return []

  const start = params.startDate.trim()
  const end = params.endDate.trim()
  const byKey = new Map<string, AnchorDrillLiveSession>()
  let dateKey = start
  while (dateKey <= end) {
    const assignment = await resolveDailyReportLiveSessionAssignments(dateKey)
    for (const session of mapOriginalSessionsWithAssignedRange(assignment, anchorName)) {
      const key = `${session.sourceShopCode}::${session.liveId}`
      if (!byKey.has(key)) byKey.set(key, session)
    }
    if (dateKey === end) break
    dateKey = addDaysShanghai(dateKey, 1)
  }
  return [...byKey.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
}

export function resolveAnchorLiveMatchHint(params: {
  anchorName: string
  scheduleRows: EffectiveScheduleRow[]
  assignment?: DailyReportLiveSessionAssignments
}): string | null {
  const anchorName = params.anchorName.trim()
  if (!anchorName || anchorName === '未归属') return null

  const hasSchedule = params.scheduleRows.some(
    (row) => row.enabled && anchorNamesMatch(row.anchorName, anchorName),
  )
  if (!hasSchedule) return '今日未排班'

  if (!params.assignment) return '未读取到真实直播场次'

  const assigned = getAssignedSessionsForAnchor(params.assignment, anchorName)
  if (assigned.length > 0) return null

  const anchorShops = new Set(
    params.scheduleRows
      .filter((row) => row.enabled && anchorNamesMatch(row.anchorName, anchorName))
      .map((row) => row.shopName.trim())
      .filter(Boolean),
  )

  const shopHasLive = params.assignment.allSessions.some((session) =>
    [...anchorShops].some((shop) => orderLiveRoomMatchesSchedule(session.sourceShopName, shop, shop)),
  )

  if (!params.assignment.allSessions.length) {
    return '未读取到真实直播场次'
  }
  if (!shopHasLive) {
    return '未读取到真实直播场次'
  }
  return '真实场次未匹配当前排班'
}

export function sumUniqueDailyReportLiveDurationMinutes(
  sessions: DailyReportLiveSession[],
): number {
  const seen = new Set<string>()
  let sum = 0
  for (const session of sessions) {
    const key = buildDailyReportLiveSessionDedupeKey(session)
    if (seen.has(key)) continue
    seen.add(key)
    sum += Math.max(0, session.durationMinutes)
  }
  return sum
}

/** 主播业绩/订单明细：按店真实场次 + 排班重叠归属某主播（仅排班匹配，不用订单支付时间） */
export async function resolveAssignedRealLiveSessionsForAnchor(params: {
  startDate: string
  endDate: string
  anchorName: string
}): Promise<DailyReportLiveSession[]> {
  const anchorName = params.anchorName.trim()
  if (!anchorName || anchorName === '未归属') return []
  if (!shouldUsePerShopRealLiveSessions(params.startDate, params.endDate)) return []

  const start = params.startDate.trim()
  const end = params.endDate.trim()
  const byLiveId = new Map<string, DailyReportLiveSession>()
  let dateKey = start
  while (dateKey <= end) {
    const assignment = await resolveDailyReportLiveSessionAssignments(dateKey)
    for (const session of getAssignedSessionsForAnchor(assignment, anchorName)) {
      const key = `${session.liveId}|${session.startTime}`
      if (!byLiveId.has(key)) byLiveId.set(key, session)
    }
    if (dateKey === end) break
    dateKey = addDaysShanghai(dateKey, 1)
  }
  return [...byLiveId.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
}
