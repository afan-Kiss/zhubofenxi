import type { UserRole } from '../types/roles'
import { getAnchorConfigSync, isOfflineOnlyAnchor } from './anchor.service'
import { isOfflineDealView } from '../utils/offline-deal-view.util'
import {
  filterViewsByAnchorSpec,
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import {
  formatLiveDurationMinutes,
  aggregateAnchorLiveSessionTraffic,
  sumNewFollowersByLiveAccountForRange,
  type AnchorLiveSessionBrief,
  type LiveRoomNewFollowerRow,
} from './anchor-live-sessions.service'
import {
  getAssignedSessionsForAnchor,
  loadAndAssignDailyReportLiveSessions,
  sumUniqueDailyReportLiveDurationMinutes,
} from './daily-report-live-sessions.service'
import {
  ANCHOR_SESSION_DISPLAY_FROM_0613,
  isReportDateOnOrAfterShopSessionCutoff,
  resolveDailyReportAnchorsForDate,
} from './anchor-performance-attribution.service'
import { remapViewsWithScheduleOverlay } from './anchor-schedule-attribution.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import {
  countDailyReportOrders,
  roundYuan,
  safeDivide,
  safeRatioPercent,
} from './daily-report-order.util'
import { calculateBusinessMetrics } from './business-metrics.service'
import { centToYuan } from '../utils/money'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { sumValidRevenueFromViews } from './valid-revenue-order.service'
import { aggregateAfterSalesReasons } from './after-sales-reason-normalize.service'
import { buildOperationsPriceBandAnalysis } from './operations-price-band.service'
import {
  buildOperationsProductAnalysis,
  type OperationsProductRow,
} from './operations-product-analysis.service'
import { getOpsReviewNote, type OpsReviewNotePayload } from './ops-review-note.service'
import type { OperationsPriceBandRow } from './operations-price-band.service'
import type { AfterSalesReasonRow } from './after-sales-reason-normalize.service'
import type { AnchorConfig, AnalyzedOrderView } from '../types/analysis'
import type { DailyReportRankingsSlice } from './operations-rankings.types'
import {
  buildDailyReportDataQualityWarnings,
  buildDailyReportRankingsSlice,
} from './operations-daily-rankings.service'
import {
  buildBusinessInsightsFromSource,
  buildBusinessInsightsSourceFromComponents,
} from './operations-business-insights.service'
import { attachBusinessInsightActions } from './operations-business-insight-action.service'
import type { BusinessInsightsPayload } from './operations-business-insights.types'
import {
  computeReturnOrderRateRatio,
  computeOperationsRefundMetricsFromViews,
  resolveOperationsAfterSalesReasonRaw,
  resolveOperationsAfterSalesRefundAmountCent,
  viewCountsAsOperationsAfterSalesReasonOrder,
} from './operations-after-sale-order.util'
import { prisma } from '../lib/prisma'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { buildDailyReportLiveScheduleFields, buildLiveSessionCountSummary, buildPerSessionLivePeriodText } from './daily-report-live-schedule-match.service'
import {
  resolveFallbackSessionDisplay,
  type AnchorAttendanceStatusPayload,
} from '../utils/anchor-attendance-status.util'

function isUnassignedOperationsView(v: AnalyzedOrderView): boolean {
  const name = String(v.anchorName ?? '').trim()
  return name === '未归属' || v.attributionType === 'unassigned'
}

export interface DailyOperationsAnchorRow extends AnchorAttendanceStatusPayload {
  anchorId?: string
  systemKey?: string | null
  attributionMode?: string | null
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
  validAmountCent: number
  validAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  returnOrderCount: number
  returnOrderRate: number | null
  paidOrderCount: number
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
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

export interface DailyOperationsSummary {
  /** 支付 GMV（支付日口径，分） */
  paymentGmvCent: number
  paymentGmvYuan: number
  /** 当前有效成交（支付日订单截至当前售后状态；与 sumValidRevenueFromViews 同源） */
  validAmountCent: number
  validAmountYuan: number
  /** 实际签收（签收事实，独立于有效成交） */
  actualSignedAmountCent: number
  actualSignedAmountYuan: number
  signedOrderCount: number
  anchorAssignedValidAmountYuan: number
  unassignedValidAmountYuan: number
  unassignedValidOrderCount: number
  /** 有效成交订单数（与 validAmount 同一订单池） */
  soldOrderCount: number
  invalidOrderCount: number
  anchorAssignedInvalidOrderCount: number
  unassignedInvalidOrderCount: number
  returnOrderCount: number
  /** 退款 P 单 ÷ 支付 P 单；分母为 0 时 null */
  returnOrderRate: number | null
  paidOrderCount: number
  dealUserCount: number | null
  dealConversionRate: number | null
  joinUserCount: number | null
  viewSessionCount: number | null
  avgOnlineUserCount: number | null
  avgViewDurationSeconds: number | null
  avgOrderAmountYuan: number | null
  totalLiveDurationMinutes: number
  assignedLiveDurationMinutes: number
  unassignedLiveDurationMinutes: number
  unassignedLiveSessionCount: number
  hourlyAmountYuan: number | null
  liveRoomNewFollowers: LiveRoomNewFollowerRow[]
  totalNewFollowerCount: number
  newFollowerRate: number | null
  /** 数据截至时间（ISO）；近 7 天售后可能继续变化 */
  dataAsOfAt: string
  afterSaleObservationImmature: boolean
}

export interface DailyOperationsReportPayload {
  dateLabel: string
  title: string
  startDate: string
  endDate: string
  summary: DailyOperationsSummary
  anchors: DailyOperationsAnchorRow[]
  products: OperationsProductRow[]
  priceBands: OperationsPriceBandRow[]
  afterSalesReasons: AfterSalesReasonRow[]
  reviewNote: OpsReviewNotePayload | null
  rankings: DailyReportRankingsSlice
  reportDataQuality: {
    reliable: boolean
    warnings: string[]
  }
  businessInsights: BusinessInsightsPayload
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

function isProductReturnOrder(v: AnalyzedOrderView): boolean {
  return v.productRefundAmountCent > 0 && !v.isFreightRefundOnly
}

function buildAnchorRow(params: {
  config: AnchorConfig
  anchorId: string
  anchorName: string
  shopName: string
  sessionLabel?: string
  reportDate: string
  validAmountCent: number
  validAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  returnOrderCount: number
  paidOrderCount: number
  sessions: AnchorLiveSessionBrief[]
  totalValidAmountYuan: number
  scheduleAttendance: AnchorAttendanceStatusPayload
  liveTimeRange: string
  liveStartTime: string | null
  liveEndTime: string | null
  scheduleTimeRange: string | null
  scheduleMatched: boolean
  scheduleMatchReason: string | null
}): DailyOperationsAnchorRow {
  const liveDurationMinutes = params.sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const liveHours = safeDivide(liveDurationMinutes, 60)
  const traffic = aggregateAnchorLiveSessionTraffic(params.sessions)
  const fallback = resolveFallbackSessionDisplay({
    fallbackSessionLabel: params.sessionLabel,
    fallbackShopName: params.shopName,
    timeRuleSessionLabel: resolveSessionLabel(params.config, params.anchorId),
    dateKey: params.reportDate,
  })
  const sessionLabel =
    params.scheduleAttendance.displaySessionLabel ||
    params.sessionLabel ||
    fallback.displaySessionLabel
  const shopName = params.scheduleAttendance.shopName || params.shopName || fallback.shopName
  const returnOrderRate = computeReturnOrderRateRatio(
    params.paidOrderCount,
    params.returnOrderCount,
  )
  return {
    anchorId: params.anchorId,
    systemKey: params.config.anchors.find((a) => a.id === params.anchorId)?.systemKey ?? null,
    attributionMode:
      params.config.anchors.find((a) => a.id === params.anchorId)?.attributionMode ?? null,
    anchorName: params.anchorName,
    livePeriodText: buildLivePeriodText(params.sessions),
    liveTimeRange: params.liveTimeRange,
    liveStartTime: params.liveStartTime,
    liveEndTime: params.liveEndTime,
    scheduleTimeRange: params.scheduleTimeRange,
    scheduleMatched: params.scheduleMatched,
    scheduleMatchReason: params.scheduleMatchReason,
    liveDurationText: buildLiveSessionCountSummary(params.sessions),
    liveDurationMinutes,
    validAmountCent: params.validAmountCent,
    validAmountYuan: params.validAmountYuan,
    soldOrderCount: params.soldOrderCount,
    invalidOrderCount: params.invalidOrderCount,
    returnOrderCount: params.returnOrderCount,
    returnOrderRate,
    paidOrderCount: params.paidOrderCount,
    avgOrderAmountYuan: roundYuan(safeDivide(params.validAmountYuan, params.soldOrderCount)),
    hourlyAmountYuan: roundYuan(
      liveHours != null ? safeDivide(params.validAmountYuan, liveHours) : null,
    ),
    amountRatio: safeRatioPercent(params.validAmountYuan, params.totalValidAmountYuan),
    viewSessionCount: traffic.viewSessionCount,
    joinUserCount: traffic.joinUserCount,
    avgOnlineUserCount: traffic.avgOnlineUserCount,
    avgViewDurationSeconds: traffic.avgViewDurationSeconds,
    newFollowerCount: traffic.newFollowerCount,
    dealUserCount: traffic.dealUserCount,
    dealConversionRate: traffic.dealConversionRate,
    newFollowerRate: traffic.newFollowerRate,
    ...params.scheduleAttendance,
    sessionLabel,
    shopName,
  }
}

export function buildAfterSalesItemsFromViews(views: AnalyzedOrderView[]): Array<{
  rawReason: string
  refundAmountCent: number
  orderKey: string
}> {
  const deduped = dedupeViewsByMetricOrderNo(views)
  const items: Array<{ rawReason: string; refundAmountCent: number; orderKey: string }> = []
  for (const v of deduped) {
    if (!viewCountsAsOperationsAfterSalesReasonOrder(v)) continue
    const orderKey = resolveMetricOrderNo(v) || v.orderId
    if (!orderKey) continue
    items.push({
      rawReason: resolveOperationsAfterSalesReasonRaw(v),
      refundAmountCent: resolveOperationsAfterSalesRefundAmountCent(v),
      orderKey,
    })
  }
  return items
}

/** 单日主播行（榜单多日聚合用，不走完整日报） */
export async function buildDailyOperationsAnchorRowsForDay(params: {
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyOperationsAnchorRow[]> {
  if (params.startDate !== params.endDate) {
    throw new Error('buildDailyOperationsAnchorRowsForDay 仅支持单日')
  }
  const dayParams = { ...params, preset: 'custom' as const }
  const scoped = await getBoardScopedViewsForRange(dayParams)
  const config = getAnchorConfigSync()
  const remappedAll = await remapViewsWithScheduleOverlay(
    attachRawByMatchToViews(scoped.views, scoped.rawByMatch),
  )
  // 日报仅统计线上直播订单：排除线下成交（offline_deal）
  const remappedOnlineAll = remappedAll.filter((v) => !isOfflineDealView(v))
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(params.startDate)
  const reportAnchors = resolveDailyReportAnchorsForDate(config, params.startDate).filter(
    (a) => !isOfflineOnlyAnchor({ systemKey: a.systemKey }),
  )
  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const liveAssignment = await loadAndAssignDailyReportLiveSessions({
    reportDate: params.startDate,
    startDate: params.startDate,
    endDate: params.endDate,
    scheduleRows: scheduleTable.rows,
  })
  const usedScheduleRowIds = new Set<string>()
  const anchorRows: DailyOperationsAnchorRow[] = []

  for (const anchor of reportAnchors) {
    if (isOfflineOnlyAnchor({ systemKey: anchor.systemKey })) continue
    const performanceViewsRaw = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    // 主播行业绩：排除线下成交，避免逸凡/线下 GMV 进入日报
    const performanceViews = performanceViewsRaw.filter((v) => !isOfflineDealView(v))
    const validRevenue = sumValidRevenueFromViews(performanceViews)
    const validAmountCent = validRevenue.validAmountCent
    const validAmountYuan = validRevenue.validAmountYuan
    const anchorAllViews = filterViewsByAnchorSpec(
      remappedOnlineAll,
      anchor.anchorId,
      anchor.anchorName,
    )
    const { soldOrderCount } = validRevenue
    const { invalidOrderCount: invalidFromPerformance } = countDailyReportOrders(performanceViews)
    const anchorRefundMetrics = computeOperationsRefundMetricsFromViews(performanceViews)
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
      validAmountYuan > 0 ||
      soldOrderCount > 0 ||
      invalidFromPerformance > 0 ||
      sessions.length > 0 ||
      performanceViews.length > 0

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
        validAmountCent,
        validAmountYuan,
        soldOrderCount,
        invalidOrderCount: invalidFromPerformance,
        returnOrderCount: anchorRefundMetrics.refundOrderCount,
        paidOrderCount: anchorRefundMetrics.paidOrderCount,
        sessions,
        totalValidAmountYuan: 0,
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

  const validAmountCent = anchorRows.reduce((sum, row) => sum + row.validAmountCent, 0)
  const validAmountYuan = centToYuan(validAmountCent)
  for (const row of anchorRows) {
    row.amountRatio = safeRatioPercent(row.validAmountYuan, validAmountYuan)
  }

  return anchorRows
}

export async function buildDailyOperationsReport(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyOperationsReportPayload> {
  if (params.startDate !== params.endDate) {
    throw new Error('运营日报仅支持单日范围')
  }

  // 单日日报必须按 custom + 当天日期取数；preset=thisWeek/thisMonth 会误拉整段周期汇总
  const dayParams = { ...params, preset: 'custom' as const }

  const scoped = await getBoardScopedViewsForRange(dayParams)
  const performanceViewsAllRaw = await getAnchorPerformanceViews(
    scoped.views,
    scoped.rawByMatch,
  )
  /**
   * 运营日报 = 线上直播经营日报。
   * 线下成交不进入日报汇总/主播/商品/退款/趋势；经营看板总 GMV 仍含线上+线下。
   */
  const onlineReportViews = performanceViewsAllRaw.filter((v) => !isOfflineDealView(v))
  const performanceViewsAll = onlineReportViews

  const anchorRows = await buildDailyOperationsAnchorRowsForDay(params)

  const storeWideValid = sumValidRevenueFromViews(performanceViewsAll)
  const storeWideMetrics = calculateBusinessMetrics(performanceViewsAll)
  const anchorAssignedValidCent = anchorRows.reduce((sum, row) => sum + row.validAmountCent, 0)
  const unassignedViews = dedupeViewsByMetricOrderNo(performanceViewsAll).filter(
    isUnassignedOperationsView,
  )
  const unassignedValid = sumValidRevenueFromViews(unassignedViews)

  const validAmountCent = storeWideValid.validAmountCent
  const validAmountYuan = storeWideValid.validAmountYuan
  const soldOrderCount = storeWideValid.soldOrderCount
  const paymentGmvCent = Math.round(storeWideMetrics.totalGmv * 100)
  const paymentGmvYuan = storeWideMetrics.totalGmv
  const actualSignedAmountCent = Math.round(storeWideMetrics.actualSignedAmount * 100)
  const actualSignedAmountYuan = storeWideMetrics.actualSignedAmount
  const signedOrderCount = storeWideMetrics.signedOrderCount
  const dataAsOfAt = new Date().toISOString()
  const afterSaleObservationImmature = (() => {
    const startMs = Date.parse(`${params.startDate}T00:00:00+08:00`)
    if (!Number.isFinite(startMs)) return false
    return Date.now() - startMs < 7 * 24 * 60 * 60 * 1000
  })()
  for (const row of anchorRows) {
    row.amountRatio = safeRatioPercent(row.validAmountYuan, validAmountYuan)
  }

  const storeWideInvalid = countDailyReportOrders(performanceViewsAll)
  const invalidOrderCount = storeWideInvalid.invalidOrderCount
  const remappedAll = (
    await remapViewsWithScheduleOverlay(attachRawByMatchToViews(scoped.views, scoped.rawByMatch))
  ).filter((v) => !isOfflineDealView(v))
  const unassignedInvalidViews = dedupeViewsByMetricOrderNo(performanceViewsAll).filter(
    isUnassignedOperationsView,
  )
  const assignedInvalidViews = dedupeViewsByMetricOrderNo(performanceViewsAll).filter(
    (v) => !isUnassignedOperationsView(v),
  )
  const anchorAssignedInvalidOrderCount =
    countDailyReportOrders(assignedInvalidViews).invalidOrderCount
  const unassignedInvalidOrderCount =
    countDailyReportOrders(unassignedInvalidViews).invalidOrderCount
  const summaryRefundMetrics = computeOperationsRefundMetricsFromViews(performanceViewsAll)

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const liveAssignment = await loadAndAssignDailyReportLiveSessions({
    reportDate: params.startDate,
    startDate: params.startDate,
    endDate: params.endDate,
    scheduleRows: scheduleTable.rows,
  })

  const totalLiveDurationMinutes = sumUniqueDailyReportLiveDurationMinutes(
    liveAssignment.allSessions,
  )
  const liveRoomNewFollowers = await sumNewFollowersByLiveAccountForRange({
    preset: dayParams.preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const totalNewFollowerCount = liveRoomNewFollowers.reduce(
    (sum, row) => sum + row.newFollowerCount,
    0,
  )
  const totalLiveHours = safeDivide(totalLiveDurationMinutes, 60)

  const summaryTraffic = aggregateAnchorLiveSessionTraffic(liveAssignment.allSessions)

  const products = await buildOperationsProductAnalysis(performanceViewsAll, scoped.rawByMatch)
  const priceBands = buildOperationsPriceBandAnalysis(performanceViewsAll)
  const afterSalesReasons = aggregateAfterSalesReasons(buildAfterSalesItemsFromViews(performanceViewsAll))
  const reviewNote = await getOpsReviewNote({
    reportDate: params.startDate,
    reportType: 'daily',
  })

  const dateLabel = formatDailyReportDateLabel(params.startDate)

  const rankings = await buildDailyReportRankingsSlice({
    anchors: anchorRows,
    products,
    limit: 10,
  })

  const statisticsIntegrityWarnings: string[] = []
  if (unassignedValid.soldOrderCount > 0) {
    statisticsIntegrityWarnings.push(
      `有 ${unassignedValid.soldOrderCount} 单有效成交未归属主播（${unassignedValid.validAmountYuan.toFixed(2)} 元），全店汇总已计入、主播表为已归属口径。`,
    )
  }
  if (unassignedInvalidOrderCount > 0) {
    statisticsIntegrityWarnings.push(
      `有 ${unassignedInvalidOrderCount} 单无效/刷单未归属主播，全店汇总已计入、主播表为已归属口径。`,
    )
  }
  if (liveAssignment.unassignedLiveSessionCount > 0) {
    statisticsIntegrityWarnings.push(
      `有 ${liveAssignment.unassignedLiveSessionCount} 场真实直播未匹配到排班，已计入总时长但不计入主播个人时长。`,
    )
  }

  const reportDataQuality = {
    reliable: rankings.products.hot.items.length > 0 || anchorRows.some((a) => a.validAmountYuan > 0),
    warnings: [
      ...buildDailyReportDataQualityWarnings({
        summary: {
          dealUserCount: summaryTraffic.dealUserCount,
          joinUserCount: summaryTraffic.joinUserCount,
          viewSessionCount: summaryTraffic.viewSessionCount,
        },
        rankings,
        reviewNote,
      }),
      ...statisticsIntegrityWarnings,
    ],
  }

  let businessInsights: BusinessInsightsPayload
  try {
    const dimensions = await prisma.productDimension.findMany()
    businessInsights = await attachBusinessInsightActions(
      buildBusinessInsightsFromSource(
        buildBusinessInsightsSourceFromComponents({
          startDate: params.startDate,
          endDate: params.endDate,
          scope: 'daily',
          anchors: anchorRows,
          products,
          priceBands,
          afterSalesReasons,
          dimensions,
          reviewNote,
          summaryTraffic: {
            dealUserCount: summaryTraffic.dealUserCount,
            joinUserCount: summaryTraffic.joinUserCount,
            viewSessionCount: summaryTraffic.viewSessionCount,
          },
          extraWarnings: reportDataQuality.warnings,
        }),
      ),
      {
        startDate: params.startDate,
        endDate: params.endDate,
        scope: 'daily',
      },
    )
  } catch (err) {
    businessInsights = {
      items: [],
      dataQuality: {
        reliable: false,
        warnings: [
          `经营建议生成失败：${err instanceof Error ? err.message : '未知错误'}`,
        ],
      },
    }
  }

  return {
    dateLabel,
    title: `${dateLabel} 运营日报`,
    startDate: params.startDate,
    endDate: params.endDate,
    summary: {
      paymentGmvCent,
      paymentGmvYuan,
      validAmountCent,
      validAmountYuan,
      actualSignedAmountCent,
      actualSignedAmountYuan,
      signedOrderCount,
      anchorAssignedValidAmountYuan: centToYuan(anchorAssignedValidCent),
      unassignedValidAmountYuan: unassignedValid.validAmountYuan,
      unassignedValidOrderCount: unassignedValid.soldOrderCount,
      soldOrderCount,
      invalidOrderCount,
      anchorAssignedInvalidOrderCount,
      unassignedInvalidOrderCount,
      returnOrderCount: summaryRefundMetrics.refundOrderCount,
      returnOrderRate: summaryRefundMetrics.rate,
      paidOrderCount: summaryRefundMetrics.paidOrderCount,
      dealUserCount: summaryTraffic.dealUserCount,
      dealConversionRate: summaryTraffic.dealConversionRate,
      joinUserCount: summaryTraffic.joinUserCount,
      viewSessionCount: summaryTraffic.viewSessionCount,
      avgOnlineUserCount: summaryTraffic.avgOnlineUserCount,
      avgViewDurationSeconds: summaryTraffic.avgViewDurationSeconds,
      avgOrderAmountYuan: roundYuan(safeDivide(validAmountYuan, soldOrderCount)),
      totalLiveDurationMinutes,
      assignedLiveDurationMinutes: liveAssignment.assignedLiveDurationMinutes,
      unassignedLiveDurationMinutes: liveAssignment.unassignedLiveDurationMinutes,
      unassignedLiveSessionCount: liveAssignment.unassignedLiveSessionCount,
      hourlyAmountYuan: roundYuan(
        totalLiveHours != null ? safeDivide(validAmountYuan, totalLiveHours) : null,
      ),
      liveRoomNewFollowers,
      totalNewFollowerCount,
      newFollowerRate: summaryTraffic.newFollowerRate,
      dataAsOfAt,
      afterSaleObservationImmature,
    },
    anchors: anchorRows,
    products,
    priceBands,
    afterSalesReasons,
    reviewNote,
    rankings,
    reportDataQuality,
    businessInsights,
  }
}

export async function buildOperationsAfterSalesDetail(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
  category?: string
}) {
  const scoped = await getBoardScopedViewsForRange(params)
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const items = buildAfterSalesItemsFromViews(performanceViews)
  const filtered = params.category
    ? aggregateAfterSalesReasons(items).filter((r) => r.category === params.category)
    : aggregateAfterSalesReasons(items)
  return { startDate: params.startDate, endDate: params.endDate, reasons: filtered, items }
}

export async function buildOperationsProductDetailReport(params: {
  preset?: string
  startDate: string
  endDate: string
  productKey: string
  role?: UserRole
  username?: string
}) {
  const scoped = await getBoardScopedViewsForRange(params)
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const products = await buildOperationsProductAnalysis(performanceViews, scoped.rawByMatch)
  return {
    startDate: params.startDate,
    endDate: params.endDate,
    product: products.find((p) => p.productKey === params.productKey) ?? null,
  }
}
