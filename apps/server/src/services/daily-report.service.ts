import type { AnchorConfig } from '../types/analysis'
import type { UserRole } from '../types/roles'
import { getAnchorConfigSync } from './anchor.service'
import {
  filterViewsByAnchorSpec,
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import {
  aggregateAnchorLiveSessionTraffic,
  sumNewFollowersByLiveAccountForRange,
  type AnchorLiveSessionBrief,
  type LiveRoomNewFollowerRow,
} from './anchor-live-sessions.service'
import {
  getAssignedSessionsForAnchor,
  resolveDailyReportLiveSessionAssignments,
  sumUniqueDailyReportLiveDurationMinutes,
} from './daily-report-live-sessions.service'
import {
  ANCHOR_SESSION_DISPLAY_FROM_0613,
  isReportDateOnOrAfterShopSessionCutoff,
  resolveDailyReportAnchorsForDate,
} from './anchor-performance-attribution.service'
import { remapViewsWithScheduleOverlay } from './anchor-schedule-attribution.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { ensureManualAnchorOverrideCache } from './order-anchor-manual-override.service'
import {
  countDailyReportOrders,
  roundMinutes,
  roundYuan,
  safeDivide,
  safeRatioPercent,
  sumDailyReportShippedFromViews,
} from './daily-report-order.util'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { buildDailyReportLiveScheduleFields, buildLiveSessionCountSummary, buildPerSessionLivePeriodText } from './daily-report-live-schedule-match.service'
import {
  resolveFallbackSessionDisplay,
  type AnchorAttendanceStatusPayload,
} from '../utils/anchor-attendance-status.util'
import { aggregateAnchorLeaderboard } from './board-metrics.service'
import { enrichAnchorLeaderboardWithLateStatus } from './anchor-late-enrichment.service'
import { enrichAnchorLeaderboardWithTrend, type AnchorTrend } from './anchor-card-trend.service'
import { ensureAnchorPerformanceLeaderboardSlots } from './anchor-performance-attribution.service'

const NO_LIVE_SESSION_TEXT = '未读取到直播场次'

export interface DailyReportAnchorRow extends AnchorAttendanceStatusPayload {
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
  liveTimeRange: string
  liveStartTime: string | null
  liveEndTime: string | null
  scheduleTimeRange: string | null
  scheduleMatched: boolean
  scheduleMatchReason: string | null
  liveDurationText: string
  liveDurationMinutes: number
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
  dealDensityMinutes: number | null
  amountRatio: number | null
  viewSessionCount: number | null
  joinUserCount: number | null
  avgOnlineUserCount: number | null
  avgViewDurationSeconds: number | null
  newFollowerCount: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  newFollowerRate: number | null
  /** 与主播卡片「本期销售额」一致，供走势对账 */
  gmvYuan?: number
  /** 与主播业绩页 anchorLeaderboard.trend 同源 */
  trend?: AnchorTrend
}

export interface DailyReportPayload {
  dateLabel: string
  title: string
  startDate: string
  endDate: string
  summary: {
    totalShippedAmountYuan: number
    totalSoldOrderCount: number
    totalInvalidOrderCount: number
    totalLiveDurationMinutes: number
    assignedLiveDurationMinutes: number
    unassignedLiveDurationMinutes: number
    unassignedLiveSessionCount: number
    liveSessionAttributionNote: string | null
    overallHourlyAmountYuan: number | null
    liveRoomNewFollowers: LiveRoomNewFollowerRow[]
    totalNewFollowerCount: number
  }
  anchors: DailyReportAnchorRow[]
}

function formatDailyReportDateLabel(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!m) return dateKey
  return `${Number(m[2])}.${Number(m[3])}`
}

function resolveSessionLabel(config: AnchorConfig, anchorId: string): string {
  const rule = config.timeRules.find((r) => r.enabled && r.anchorId === anchorId)
  if (!rule) return '场次'
  const startHour = Number(rule.startTime.split(':')[0] ?? 0)
  if (startHour >= 22) return '夜场'
  if (startHour >= 18) return '晚场'
  if (startHour >= 12) return '午场'
  return '早场'
}

function buildLivePeriodText(sessions: AnchorLiveSessionBrief[]): string {
  if (sessions.length === 0) return '—'
  return buildPerSessionLivePeriodText(sessions)
}

function pickShopNameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const keys = ['shopName', 'shop_name', 'sellerShopName', 'seller_shop_name', 'storeName', 'store_name']
  for (const k of keys) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function resolveAnchorShopName(
  views: ReturnType<typeof attachRawByMatchToViews>,
  sessions: AnchorLiveSessionBrief[],
): string {
  const counts = new Map<string, number>()
  for (const view of views) {
    const liveAccountName = (view.liveAccountName ?? '').trim()
    if (liveAccountName && liveAccountName !== '—') {
      counts.set(liveAccountName, (counts.get(liveAccountName) ?? 0) + 1)
    }
    const shopName = pickShopNameFromRaw(view.raw)
    if (shopName && shopName !== '—') {
      counts.set(shopName, (counts.get(shopName) ?? 0) + 1)
    }
  }
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  }
  for (const session of sessions) {
    const liveName = (session.liveName ?? '').trim()
    if (liveName && liveName !== '—') return liveName
  }
  return ''
}

function formatSessionLabelWithShop(sessionLabel: string, shopName: string): string {
  if (!shopName) return sessionLabel
  return `${sessionLabel}·${shopName}`
}

function buildAnchorRow(params: {
  config: AnchorConfig
  anchorId: string
  anchorName: string
  shopName: string
  sessionLabel?: string
  reportDate: string
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  sessions: AnchorLiveSessionBrief[]
  totalShippedAmountYuan: number
  scheduleAttendance: AnchorAttendanceStatusPayload
  liveTimeRange: string
  liveStartTime: string | null
  liveEndTime: string | null
  scheduleTimeRange: string | null
  scheduleMatched: boolean
  scheduleMatchReason: string | null
}): DailyReportAnchorRow {
  const liveDurationMinutes = params.sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const liveHours = safeDivide(liveDurationMinutes, 60)
  const traffic =
    params.sessions.length > 0 ? aggregateAnchorLiveSessionTraffic(params.sessions) : null
  const hasRealSessions = params.sessions.length > 0
  const sessionLabel =
    params.scheduleAttendance.displaySessionLabel ||
    params.sessionLabel ||
    (hasRealSessions
      ? resolveFallbackSessionDisplay({
          fallbackSessionLabel: params.sessionLabel,
          fallbackShopName: params.shopName,
          timeRuleSessionLabel: resolveSessionLabel(params.config, params.anchorId),
          dateKey: params.reportDate,
        }).displaySessionLabel
      : '')
  const shopName =
    params.scheduleAttendance.shopName ||
    params.shopName ||
    (hasRealSessions
      ? resolveFallbackSessionDisplay({
          fallbackSessionLabel: params.sessionLabel,
          fallbackShopName: params.shopName,
          timeRuleSessionLabel: resolveSessionLabel(params.config, params.anchorId),
          dateKey: params.reportDate,
        }).shopName
      : '')
  const liveDurationText = hasRealSessions ? buildLiveSessionCountSummary(params.sessions) : '—'
  const liveTimeRange = hasRealSessions
    ? params.liveTimeRange && params.liveTimeRange !== '—'
      ? params.liveTimeRange
      : buildLivePeriodText(params.sessions).replace(/~/g, '–')
    : NO_LIVE_SESSION_TEXT
  return {
    anchorName: params.anchorName,
    livePeriodText: hasRealSessions ? buildLivePeriodText(params.sessions) : '—',
    liveTimeRange,
    liveStartTime: hasRealSessions ? params.liveStartTime : null,
    liveEndTime: hasRealSessions ? params.liveEndTime : null,
    scheduleTimeRange: params.scheduleTimeRange,
    scheduleMatched: params.scheduleMatched,
    scheduleMatchReason: params.scheduleMatchReason,
    liveDurationText,
    liveDurationMinutes,
    shippedAmountYuan: params.shippedAmountYuan,
    soldOrderCount: params.soldOrderCount,
    invalidOrderCount: params.invalidOrderCount,
    avgOrderAmountYuan: roundYuan(
      safeDivide(params.shippedAmountYuan, params.soldOrderCount),
    ),
    hourlyAmountYuan: roundYuan(
      liveHours != null ? safeDivide(params.shippedAmountYuan, liveHours) : null,
    ),
    dealDensityMinutes: roundMinutes(
      safeDivide(liveDurationMinutes, params.soldOrderCount),
    ),
    amountRatio: safeRatioPercent(params.shippedAmountYuan, params.totalShippedAmountYuan),
    viewSessionCount: traffic?.viewSessionCount ?? null,
    joinUserCount: traffic?.joinUserCount ?? null,
    avgOnlineUserCount: traffic?.avgOnlineUserCount ?? null,
    avgViewDurationSeconds: traffic?.avgViewDurationSeconds ?? null,
    newFollowerCount: traffic?.newFollowerCount ?? null,
    dealUserCount: traffic?.dealUserCount ?? null,
    dealConversionRate: traffic?.dealConversionRate ?? null,
    newFollowerRate: traffic?.newFollowerRate ?? null,
    ...params.scheduleAttendance,
    sessionLabel,
    shopName,
  }
}

export async function buildDailyReport(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyReportPayload> {
  const scoped = await getBoardScopedViewsForRange({
    ...params,
    preset: 'custom',
  })
  await ensureManualAnchorOverrideCache()
  const config = getAnchorConfigSync()
  const anchorRows: DailyReportAnchorRow[] = []
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(params.startDate)
  const remappedAll = await remapViewsWithScheduleOverlay(
    attachRawByMatchToViews(scoped.views, scoped.rawByMatch),
  )

  const reportAnchors = resolveDailyReportAnchorsForDate(config, params.startDate)
  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const liveAssignment = await resolveDailyReportLiveSessionAssignments(params.startDate)
  const usedScheduleRowIds = new Set<string>()
  for (const anchor of reportAnchors) {
    const performanceViews = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    const shipped = sumDailyReportShippedFromViews(performanceViews)
    const shippedAmountYuan = shipped.shippedAmountYuan

    const anchorAllViews = filterViewsByAnchorSpec(remappedAll, anchor.anchorId, anchor.anchorName)
    const { soldOrderCount } = shipped
    const { invalidOrderCount: invalidFromAll } = countDailyReportOrders(anchorAllViews)
    const fixedDisplay = useShopSessionRules
      ? ANCHOR_SESSION_DISPLAY_FROM_0613[anchor.anchorName]
      : undefined

    const sessions = getAssignedSessionsForAnchor(liveAssignment, anchor.anchorName)

    const liveSchedule = buildDailyReportLiveScheduleFields({
      anchorName: anchor.anchorName,
      allSessions: sessions,
      scheduleRows: scheduleTable.rows,
      usedScheduleRowIds,
    })

    const hasData =
      shippedAmountYuan > 0 ||
      soldOrderCount > 0 ||
      invalidFromAll > 0 ||
      sessions.length > 0 ||
      performanceViews.length > 0

    // 6.13 起固定场次主播：与主播业绩一致，无数据也保留空行（含 6.18 起的小白）
    if (!hasData && !useShopSessionRules) continue

    const shopNameHint =
      fixedDisplay?.shopName ?? resolveAnchorShopName(anchorAllViews, sessions)

    const scheduleAttendance = liveSchedule.scheduleAttendance

    const shopName =
      scheduleAttendance.shopName || liveSchedule.primaryScheduleRow?.shopName || shopNameHint

    anchorRows.push(
      buildAnchorRow({
        config,
        anchorId: anchor.anchorId,
        anchorName: anchor.anchorName,
        shopName,
        reportDate: params.startDate,
        sessionLabel: scheduleAttendance.hasSchedule
          ? scheduleAttendance.displaySessionLabel
          : fixedDisplay?.sessionLabel,
        shippedAmountYuan,
        soldOrderCount,
        invalidOrderCount: invalidFromAll,
        sessions,
        totalShippedAmountYuan: 0,
        scheduleAttendance,
        liveTimeRange: liveSchedule.liveTimeRange,
        liveStartTime: liveSchedule.liveStartTime,
        liveEndTime: liveSchedule.liveEndTime,
        scheduleTimeRange: liveSchedule.scheduleTimeRange,
        scheduleMatched: liveSchedule.scheduleMatched,
        scheduleMatchReason: liveSchedule.scheduleMatchReason,
      }),
    )
  }

  const totalShippedAmountYuan = anchorRows.reduce((sum, row) => sum + row.shippedAmountYuan, 0)
  for (const row of anchorRows) {
    row.amountRatio = safeRatioPercent(row.shippedAmountYuan, totalShippedAmountYuan)
  }

  anchorRows.sort((a, b) => {
    if (b.shippedAmountYuan !== a.shippedAmountYuan) {
      return b.shippedAmountYuan - a.shippedAmountYuan
    }
    return a.anchorName.localeCompare(b.anchorName, 'zh-CN')
  })

  const allPerformanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  let leaderboardRows = ensureAnchorPerformanceLeaderboardSlots(
    aggregateAnchorLeaderboard(allPerformanceViews),
    params.startDate,
  ) as unknown as Array<Record<string, unknown>>
  leaderboardRows = await enrichAnchorLeaderboardWithLateStatus(leaderboardRows, {
    startDate: params.startDate,
    endDate: params.endDate,
    preset: 'custom',
  })
  leaderboardRows = await enrichAnchorLeaderboardWithTrend(leaderboardRows, allPerformanceViews, {
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const trendByAnchor = new Map(leaderboardRows.map((r) => [String(r.anchorName ?? ''), r]))
  for (const row of anchorRows) {
    const lb = trendByAnchor.get(row.anchorName)
    if (!lb) continue
    row.gmvYuan = Number(lb.gmv ?? lb.totalGmv ?? 0)
    row.trend = lb.trend as AnchorTrend | undefined
  }

  const totalSoldOrderCount = anchorRows.reduce((sum, row) => sum + row.soldOrderCount, 0)
  const totalInvalidOrderCount = anchorRows.reduce((sum, row) => sum + row.invalidOrderCount, 0)
  const totalLiveDurationMinutes = sumUniqueDailyReportLiveDurationMinutes(
    liveAssignment.allSessions,
  )
  const liveSessionAttributionNote =
    liveAssignment.unassignedLiveSessionCount > 0
      ? `有 ${liveAssignment.unassignedLiveSessionCount} 场真实直播未匹配到排班，已计入总时长但不计入主播个人时长。`
      : null
  const liveRoomNewFollowers = await sumNewFollowersByLiveAccountForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const totalNewFollowerCount = liveRoomNewFollowers.reduce(
    (sum, row) => sum + row.newFollowerCount,
    0,
  )
  const totalLiveHours = safeDivide(totalLiveDurationMinutes, 60)

  const dateLabel = formatDailyReportDateLabel(params.startDate)

  return {
    dateLabel,
    title: `${dateLabel} 主播日报`,
    startDate: params.startDate,
    endDate: params.endDate,
    summary: {
      totalShippedAmountYuan,
      totalSoldOrderCount,
      totalInvalidOrderCount,
      totalLiveDurationMinutes,
      assignedLiveDurationMinutes: liveAssignment.assignedLiveDurationMinutes,
      unassignedLiveDurationMinutes: liveAssignment.unassignedLiveDurationMinutes,
      unassignedLiveSessionCount: liveAssignment.unassignedLiveSessionCount,
      liveSessionAttributionNote,
      overallHourlyAmountYuan: roundYuan(
        totalLiveHours != null ? safeDivide(totalShippedAmountYuan, totalLiveHours) : null,
      ),
      liveRoomNewFollowers,
      totalNewFollowerCount,
    },
    anchors: anchorRows,
  }
}
