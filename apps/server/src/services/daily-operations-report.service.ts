import type { UserRole } from '../types/roles'
import { getAnchorConfigSync } from './anchor.service'
import { aggregateAnchorLeaderboard } from './board-metrics.service'
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
  roundYuan,
  safeDivide,
  safeRatioPercent,
} from './daily-report-order.util'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
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

export interface DailyOperationsAnchorRow {
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
  liveDurationText: string
  liveDurationMinutes: number
  validAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  returnOrderCount: number
  returnOrderRate: number | null
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
  validAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  returnOrderCount: number
  returnOrderRate: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  joinUserCount: number | null
  viewSessionCount: number | null
  avgOnlineUserCount: number | null
  avgViewDurationSeconds: number | null
  avgOrderAmountYuan: number | null
  totalLiveDurationMinutes: number
  hourlyAmountYuan: number | null
  liveRoomNewFollowers: LiveRoomNewFollowerRow[]
  totalNewFollowerCount: number
  newFollowerRate: number | null
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

function isProductReturnOrder(v: AnalyzedOrderView): boolean {
  return v.productRefundAmountCent > 0 && !v.isFreightRefundOnly
}

function countReturnOrders(views: AnalyzedOrderView[]): number {
  const deduped = dedupeViewsByMetricOrderNo(views)
  const keys = new Set<string>()
  for (const v of deduped) {
    if (!isProductReturnOrder(v)) continue
    const key = resolveMetricOrderNo(v) || v.orderId
    if (key) keys.add(key)
  }
  return keys.size
}

function buildAnchorRow(params: {
  config: AnchorConfig
  anchorId: string
  anchorName: string
  shopName: string
  sessionLabel?: string
  validAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  returnOrderCount: number
  sessions: AnchorLiveSessionBrief[]
  totalValidAmountYuan: number
}): DailyOperationsAnchorRow {
  const liveDurationMinutes = params.sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const liveHours = safeDivide(liveDurationMinutes, 60)
  const traffic = aggregateAnchorLiveSessionTraffic(params.sessions)
  const sessionLabel =
    params.sessionLabel ??
    formatSessionLabelWithShop(
      resolveSessionLabel(params.config, params.anchorId),
      params.shopName,
    )
  const returnDenom = params.soldOrderCount + params.returnOrderCount
  return {
    anchorName: params.anchorName,
    sessionLabel,
    shopName: params.shopName,
    livePeriodText: buildLivePeriodText(params.sessions),
    liveDurationText: formatLiveDurationMinutes(liveDurationMinutes),
    liveDurationMinutes,
    validAmountYuan: params.validAmountYuan,
    soldOrderCount: params.soldOrderCount,
    invalidOrderCount: params.invalidOrderCount,
    returnOrderCount: params.returnOrderCount,
    returnOrderRate:
      returnDenom > 0 ? Math.round((params.returnOrderCount / returnDenom) * 100) : null,
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
    if (!isProductReturnOrder(v)) continue
    const orderKey = resolveMetricOrderNo(v) || v.orderId
    if (!orderKey) continue
    const rawReason =
      v.afterSalesWorkbenchReason?.trim() ||
      v.afterSaleReasonText?.trim() ||
      v.reasonText?.trim() ||
      v.finalAfterSaleReason?.trim() ||
      ''
    items.push({
      rawReason,
      refundAmountCent: v.productRefundAmountCent,
      orderKey,
    })
  }
  return items
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

  const scoped = await getBoardScopedViewsForRange(params)
  const config = getAnchorConfigSync()
  const remappedAll = remapViewsForAnchorPerformance(
    attachRawByMatchToViews(scoped.views, scoped.rawByMatch),
  )
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(params.startDate)
  const performanceViewsAll = getAnchorPerformanceViews(
    scoped.views,
    scoped.rawByMatch,
  )

  const anchorRows: DailyOperationsAnchorRow[] = []
  const reportAnchors = resolveDailyReportAnchorsForDate(config, params.startDate)

  for (const anchor of reportAnchors) {
    const performanceViews = getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    const leaderboard = aggregateAnchorLeaderboard(performanceViews)
    const stats = leaderboard.find(
      (row) => row.anchorId === anchor.anchorId || row.anchorName === anchor.anchorName,
    )
    const validAmountYuan = Number(stats?.validSalesAmount ?? 0)
    const anchorAllViews = filterViewsByAnchorSpec(remappedAll, anchor.anchorId, anchor.anchorName)
    const { soldOrderCount, invalidOrderCount } = countDailyReportOrders(performanceViews)
    const invalidFromAll = countDailyReportOrders(anchorAllViews).invalidOrderCount
    const returnOrderCount = countReturnOrders(performanceViews)
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
      validAmountYuan > 0 ||
      soldOrderCount > 0 ||
      invalidFromAll > 0 ||
      sessions.length > 0 ||
      performanceViews.length > 0

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
        validAmountYuan,
        soldOrderCount,
        invalidOrderCount: invalidFromAll,
        returnOrderCount,
        sessions,
        totalValidAmountYuan: 0,
      }),
    )
  }

  const validAmountYuan = anchorRows.reduce((sum, row) => sum + row.validAmountYuan, 0)
  for (const row of anchorRows) {
    row.amountRatio = safeRatioPercent(row.validAmountYuan, validAmountYuan)
  }

  const soldOrderCount = anchorRows.reduce((sum, row) => sum + row.soldOrderCount, 0)
  const invalidOrderCount = anchorRows.reduce((sum, row) => sum + row.invalidOrderCount, 0)
  const returnOrderCount = countReturnOrders(performanceViewsAll)
  const returnDenom = soldOrderCount + returnOrderCount

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

  const allSessions = (
    await Promise.all(
      reportAnchors.map((anchor) =>
        resolveAnchorLiveSessionsForRange({
          preset: params.preset,
          startDate: params.startDate,
          endDate: params.endDate,
          anchorId: anchor.anchorId,
          anchorName: anchor.anchorName,
        }),
      ),
    )
  ).flat()
  const summaryTraffic = aggregateAnchorLiveSessionTraffic(allSessions)

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
  const reportDataQuality = {
    reliable: rankings.products.hot.items.length > 0 || anchorRows.some((a) => a.validAmountYuan > 0),
    warnings: buildDailyReportDataQualityWarnings({
      summary: {
        dealUserCount: summaryTraffic.dealUserCount,
        joinUserCount: summaryTraffic.joinUserCount,
        viewSessionCount: summaryTraffic.viewSessionCount,
      },
      rankings,
      reviewNote,
    }),
  }

  return {
    dateLabel,
    title: `${dateLabel} 运营日报`,
    startDate: params.startDate,
    endDate: params.endDate,
    summary: {
      validAmountYuan,
      soldOrderCount,
      invalidOrderCount,
      returnOrderCount,
      returnOrderRate:
        returnDenom > 0 ? Math.round((returnOrderCount / returnDenom) * 100) : null,
      dealUserCount: summaryTraffic.dealUserCount,
      dealConversionRate: summaryTraffic.dealConversionRate,
      joinUserCount: summaryTraffic.joinUserCount,
      viewSessionCount: summaryTraffic.viewSessionCount,
      avgOnlineUserCount: summaryTraffic.avgOnlineUserCount,
      avgViewDurationSeconds: summaryTraffic.avgViewDurationSeconds,
      avgOrderAmountYuan: roundYuan(safeDivide(validAmountYuan, soldOrderCount)),
      totalLiveDurationMinutes,
      hourlyAmountYuan: roundYuan(
        totalLiveHours != null ? safeDivide(validAmountYuan, totalLiveHours) : null,
      ),
      liveRoomNewFollowers,
      totalNewFollowerCount,
      newFollowerRate: summaryTraffic.newFollowerRate,
    },
    anchors: anchorRows,
    products,
    priceBands,
    afterSalesReasons,
    reviewNote,
    rankings,
    reportDataQuality,
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
  const performanceViews = getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
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
  const performanceViews = getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const products = await buildOperationsProductAnalysis(performanceViews, scoped.rawByMatch)
  return {
    startDate: params.startDate,
    endDate: params.endDate,
    product: products.find((p) => p.productKey === params.productKey) ?? null,
  }
}
