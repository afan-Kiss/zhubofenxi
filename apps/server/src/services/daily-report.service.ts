import type { AnchorConfig } from '../types/analysis'
import type { UserRole } from '../types/roles'
import { getAnchorConfigSync } from './anchor.service'
import {
  filterViewsByAnchorSpec,
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import {
  formatLiveDurationMinutes,
  resolveAnchorLiveSessionsForRange,
  aggregateAnchorLiveSessionTraffic,
  sumUniqueLiveDurationMinutesForRange,
  sumNewFollowersByLiveAccountForRange,
  type AnchorLiveSessionBrief,
  type LiveRoomNewFollowerRow,
} from './anchor-live-sessions.service'
import {
  ANCHOR_SESSION_DISPLAY_FROM_0613,
  isReportDateOnOrAfterShopSessionCutoff,
  remapViewsForAnchorPerformance,
  resolveDailyReportAnchorsForDate,
} from './anchor-performance-attribution.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import {
  countDailyReportOrders,
  roundMinutes,
  roundYuan,
  safeDivide,
  safeRatioPercent,
} from './daily-report-order.util'
import { sumValidRevenueFromViews } from './valid-revenue-order.service'

export interface DailyReportAnchorRow {
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
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
  if (sessions.length === 1) {
    const s = sessions[0]!
    return `${s.startTime.slice(11, 16)}~${s.endTime.slice(11, 16)}`
  }
  const first = sessions[0]!
  const last = sessions[sessions.length - 1]!
  return `${first.startTime.slice(11, 16)}~${last.endTime.slice(11, 16)}`
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
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  sessions: AnchorLiveSessionBrief[]
  totalShippedAmountYuan: number
}): DailyReportAnchorRow {
  const liveDurationMinutes = params.sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const liveHours = safeDivide(liveDurationMinutes, 60)
  const traffic = aggregateAnchorLiveSessionTraffic(params.sessions)
  const sessionLabel =
    params.sessionLabel ??
    formatSessionLabelWithShop(
      resolveSessionLabel(params.config, params.anchorId),
      params.shopName,
    )
  return {
    anchorName: params.anchorName,
    sessionLabel,
    shopName: params.shopName,
    livePeriodText: buildLivePeriodText(params.sessions),
    liveDurationText: formatLiveDurationMinutes(liveDurationMinutes),
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
    viewSessionCount: traffic.viewSessionCount,
    joinUserCount: traffic.joinUserCount,
    avgOnlineUserCount: traffic.avgOnlineUserCount,
    avgViewDurationSeconds: traffic.avgViewDurationSeconds,
    newFollowerCount: traffic.newFollowerCount,
    dealUserCount: traffic.dealUserCount,
    dealConversionRate: traffic.dealConversionRate,
    newFollowerRate: traffic.newFollowerRate,
  }
}

export async function buildDailyReport(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyReportPayload> {
  const scoped = await getBoardScopedViewsForRange(params)
  const config = getAnchorConfigSync()
  const anchorRows: DailyReportAnchorRow[] = []
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(params.startDate)
  const remappedAll = remapViewsForAnchorPerformance(
    attachRawByMatchToViews(scoped.views, scoped.rawByMatch),
  )

  const reportAnchors = resolveDailyReportAnchorsForDate(config, params.startDate)
  for (const anchor of reportAnchors) {
    const performanceViews = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    const validRevenue = sumValidRevenueFromViews(performanceViews)
    const shippedAmountYuan = validRevenue.validAmountYuan

    const anchorAllViews = filterViewsByAnchorSpec(remappedAll, anchor.anchorId, anchor.anchorName)
    const { soldOrderCount } = validRevenue
    const { invalidOrderCount: invalidFromAll } = countDailyReportOrders(anchorAllViews)
    const fixedDisplay = useShopSessionRules
      ? ANCHOR_SESSION_DISPLAY_FROM_0613[anchor.anchorName]
      : undefined
    const sessions = await resolveAnchorLiveSessionsForRange({
      preset: params.preset,
      startDate: params.startDate,
      endDate: params.endDate,
      anchorId: anchor.anchorId,
      anchorName: anchor.anchorName,
      anchorOrders: performanceViews,
    })

    const hasData =
      shippedAmountYuan > 0 ||
      soldOrderCount > 0 ||
      invalidFromAll > 0 ||
      sessions.length > 0 ||
      performanceViews.length > 0

    // 6.13 起固定场次主播：与主播业绩一致，无数据也保留空行（含 6.18 起的小白）
    if (!hasData && !useShopSessionRules) continue

    anchorRows.push(
      buildAnchorRow({
        config,
        anchorId: anchor.anchorId,
        anchorName: anchor.anchorName,
        shopName:
          fixedDisplay?.shopName ??
          resolveAnchorShopName(anchorAllViews, sessions),
        sessionLabel: fixedDisplay?.sessionLabel,
        shippedAmountYuan,
        soldOrderCount,
        invalidOrderCount: invalidFromAll,
        sessions,
        totalShippedAmountYuan: 0,
      }),
    )
  }

  const totalShippedAmountYuan = anchorRows.reduce((sum, row) => sum + row.shippedAmountYuan, 0)
  for (const row of anchorRows) {
    row.amountRatio = safeRatioPercent(row.shippedAmountYuan, totalShippedAmountYuan)
  }

  const totalSoldOrderCount = anchorRows.reduce((sum, row) => sum + row.soldOrderCount, 0)
  const totalInvalidOrderCount = anchorRows.reduce((sum, row) => sum + row.invalidOrderCount, 0)
  const totalLiveDurationMinutes = await sumUniqueLiveDurationMinutesForRange({
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const liveRoomNewFollowers = await sumNewFollowersByLiveAccountForRange({
    preset: params.preset,
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
      overallHourlyAmountYuan: roundYuan(
        totalLiveHours != null ? safeDivide(totalShippedAmountYuan, totalLiveHours) : null,
      ),
      liveRoomNewFollowers,
      totalNewFollowerCount,
    },
    anchors: anchorRows,
  }
}
