import { randomUUID } from 'node:crypto'
import type { AnalyzedOrderView } from '../types/analysis'
import {
  endOfDay,
  formatDateKey,
  resolveDateRange,
  startOfDay,
  type DateRangePreset,
} from '../utils/date-range'
import { hasAnyEnabledApi } from './xhs-api-sync/xhs-api-registry'
import { XHS_API_NOT_CONFIGURED_MSG } from './xhs-api-sync/xhs-api-types'
import { fetchLiveRangeAnalysis } from './board-live-analysis.service'
import { viewBelongsToAnchor } from './anchor-attribution.util'
import {
  aggregateAnchorLeaderboard,
  aggregateViewsMetrics,
  normalizeBoardPreset,
} from './board-metrics.service'
import { buildBlacklistedBuyerIds, calculateBusinessMetrics } from './business-metrics.service'
import { logAnchorMetricsDebug, logBoardMetricsDebug, warnAnchorTotalsMismatch } from './board-metrics-debug.service'
import { mapViewToBoardDrillRow } from './order-row-mapper.service'
import { AMOUNT_FORMULA_VERSION } from './order-amount-metrics.service'
import {
  completeLiveQueryJob,
  createLiveQueryJob,
  failLiveQueryJob,
  getLiveQueryJob,
  updateLiveQueryProgress,
} from './board-live-query-store'
import type { XhsRequestAuditContext } from './xhs-http.service'
import {
  buildQualityFeedbackPublicStatus,
  ensureOfficialQualityBadCaseFreshForPageView,
} from './quality-badcase-auto-sync.service'
import type { QualityFeedbackPublicStatus } from './quality-badcase-auto-sync.service'
import { buildAnchorPerformanceViewsFromScopedViews } from './anchor-performance-views.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { enrichAnchorLeaderboardWithLateStatus } from './anchor-late-enrichment.service'
import { enrichAnchorLeaderboardWithTrend } from './anchor-card-trend.service'

export type BoardLiveQueryPreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'thisMonth'
  | 'custom'

export interface BoardLiveQueryParams {
  preset: BoardLiveQueryPreset
  startDate?: string
  endDate?: string
  anchorId?: string
  anchorName?: string
  page?: number
  pageSize?: number
  triggeredBy?: string | null
  audit?: XhsRequestAuditContext
}

export interface BoardLiveQueryResult {
  requestId: string
  preset: string
  startDate: string
  endDate: string
  rangeKey?: string
  resolvedRange?: { preset: string; startDate: string; endDate: string }
  source: 'local_db' | 'live_api'
  isFromCache: boolean
  fetchedAt: string
  progress: {
    totalPages: number
    fetchedPages: number
    totalOrders: number
    message: string
  }
  summary: Record<string, unknown>
  anchorPerformanceSummary?: Record<string, unknown>
  anchorLeaderboard: Array<Record<string, unknown>>
  orders: Array<Record<string, unknown>>
  allOrders: Array<Record<string, unknown>>
  ordersTotal: number
  page: number
  pageSize: number
  blacklistedBuyerIds: string[]
  debug: {
    orderNos: string[]
    includedOrderNos: string[]
    excludedOrderNos: string[]
    gmvField: string
    formulaVersion: string
  }
  unmatchedAfterSaleRecords?: import('./order-master-match.service').UnmatchedAfterSaleRecord[]
  fetchMeta?: {
    orderPagesRead?: number
    orderRowsRead?: number
    afterSalePagesRead?: number
    afterSaleRowsRead?: number
  }
  qualityFeedback?: QualityFeedbackPublicStatus
  dataDisplayStatus?:
    | 'ready'
    | 'syncing_with_cache'
    | 'syncing_no_cache'
    | 'failed_with_cache'
    | 'empty'
    | 'coverage_missing'
}

function resolveLiveQueryRange(params: BoardLiveQueryParams): {
  startDate: string
  endDate: string
} {
  const range = resolveDateRange(
    normalizeBoardPreset(params.preset) as DateRangePreset,
    params.startDate,
    params.endDate,
  )
  return {
    startDate: range.startDate,
    endDate: range.endDate,
  }
}

function filterViewsByAnchor(
  views: AnalyzedOrderView[],
  anchorId?: string,
  anchorName?: string,
): AnalyzedOrderView[] {
  const id = anchorId?.trim()
  const name = anchorName?.trim()
  if (!id && (!name || name === '全部')) return views
  return views.filter((v) => viewBelongsToAnchor(v, { anchorId: id, anchorName: name }))
}

function buildSummaryFromViews(views: AnalyzedOrderView[]): Record<string, unknown> {
  const m = calculateBusinessMetrics(views)
  const legacy = aggregateViewsMetrics(views)
  return {
    metricsVersion: m.version,
    productGmv: m.totalGmv,
    totalGmv: m.totalGmv,
    gmv: m.totalGmv,
    effectiveGmv: m.validSalesAmount,
    validSalesAmount: m.validSalesAmount,
    actualSignedAmount: m.actualSignedAmount,
    orderCount: m.orderCount,
    paidOrderCount: m.orderCount,
    periodOrderCount: m.periodOrderCount,
    signRate: m.signRate,
    returnRate: m.refundRate,
    afterSaleRecordCount: m.afterSaleRecordCount,
    returnRefundCount: m.returnOrderCount,
    returnRefundRate: m.returnRate,
    qualityReturnRate: legacy.qualityReturnRate,
    signedOrderCount: m.signedOrderCount,
    actualSignedCount: m.signedOrderCount,
    returnCount: m.refundOrderCount,
    refundWithAmountOrderCount: m.refundWithAmountOrderCount,
    qualityReturnCount: m.qualityRefundOrderCount,
    returnAmount: m.refundAmount,
    productRefundAmount: m.refundAmount,
    freightRefundAmount: m.freightRefundAmount,
  }
}

function mapOrderRow(
  v: AnalyzedOrderView,
  raw?: Record<string, unknown>,
  isBlacklistedBuyer = false,
): Record<string, unknown> {
  return mapViewToBoardDrillRow(
    Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
    { isBlacklistedBuyer, useBuyerRefund: true },
  ) as unknown as Record<string, unknown>
}

/**
 * 实时拉单查询（live_api）。主播业绩主页面已走 /api/board/local-data；
 * 本路径仍用于经营总览补数、系统 acceptance、导出对账等，主播 leaderboard 须与 remap 口径一致。
 */
export async function executeBoardLiveQuery(
  params: BoardLiveQueryParams,
  existingRequestId?: string,
): Promise<BoardLiveQueryResult> {
  const requestId = existingRequestId ?? randomUUID()
  if (!existingRequestId) createLiveQueryJob(requestId)

  const { startDate, endDate } = resolveLiveQueryRange(params)
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(5000, Math.max(1, params.pageSize ?? 20))

  let fetchedPages = 0
  let totalPageEstimate = 0
  let totalOrders = 0

  try {
    if (!hasAnyEnabledApi()) {
      throw new Error(XHS_API_NOT_CONFIGURED_MSG)
    }

    ensureOfficialQualityBadCaseFreshForPageView()
    const qualityFeedback = await buildQualityFeedbackPublicStatus()

    const { views: allViews, rawByMatch, bundle } = await fetchLiveRangeAnalysis({
      startDate,
      endDate,
      requestId,
      audit: params.audit,
      onProgress: (info) => {
        fetchedPages = info.fetchedPages
        totalPageEstimate = info.totalPages ?? fetchedPages
        totalOrders = info.totalOrders
        updateLiveQueryProgress(requestId, {
          fetchedPages,
          totalPages: totalPageEstimate,
          totalOrders,
          message: info.message,
        })
      },
    })

    updateLiveQueryProgress(requestId, {
      message: '正在计算 GMV、退款、签收、品退...',
      fetchedPages,
      totalPages: totalPageEstimate,
      totalOrders,
    })

    const viewsWithRaw = attachRawByMatchToViews(allViews, rawByMatch)
    const coreViews = filterViewsForCoreMetrics(viewsWithRaw)
    const performanceViews = await buildAnchorPerformanceViewsFromScopedViews(allViews, rawByMatch)
    const scopedCoreViews = filterViewsByAnchor(coreViews, params.anchorId, params.anchorName)
    const scopedPerformanceViews = filterViewsByAnchor(
      performanceViews,
      params.anchorId,
      params.anchorName,
    )
    const debugCtx = {
      scope: 'live-query',
      dateRange: { startDate, endDate, preset: params.preset },
    }
    logBoardMetricsDebug(scopedCoreViews, { ...debugCtx, fetchMeta: bundle.fetchMeta })
    const summary = buildSummaryFromViews(scopedCoreViews)
    const anchorPerformanceSummary = buildSummaryFromViews(
      params.anchorId || params.anchorName ? scopedPerformanceViews : performanceViews,
    )
    const anchorLeaderboardRaw = aggregateAnchorLeaderboard(
      params.anchorId || params.anchorName ? scopedPerformanceViews : performanceViews,
      debugCtx,
      {
        liveSessions: bundle?.liveSessions ?? [],
        qualityRefundViews: params.anchorId || params.anchorName ? scopedCoreViews : coreViews,
      },
    )
    const anchorLeaderboardWithLate = await enrichAnchorLeaderboardWithLateStatus(
      anchorLeaderboardRaw as unknown as Array<Record<string, unknown>>,
      { startDate, endDate, preset: params.preset },
    )
    const performanceViewsForTrend = params.anchorId || params.anchorName
      ? scopedPerformanceViews
      : performanceViews
    const anchorLeaderboard = await enrichAnchorLeaderboardWithTrend(
      anchorLeaderboardWithLate,
      performanceViewsForTrend,
      { preset: params.preset, startDate, endDate },
    )
    warnAnchorTotalsMismatch(summary, anchorLeaderboard as unknown as Array<Record<string, unknown>>)
    const blacklistedBuyerIds = [...buildBlacklistedBuyerIds(scopedCoreViews)]

    const orderRows: Array<Record<string, unknown>> = scopedCoreViews.map((v) => {
      const raw = rawByMatch.get(v.matchOrderId || v.orderId)
      const bid = v.buyerId?.trim() ?? ''
      const nick = String(
        (raw as Record<string, unknown> | undefined)?._buyerNickname ?? v.buyerId ?? '',
      )
      const blocked =
        blacklistedBuyerIds.includes(bid) || blacklistedBuyerIds.includes(`nick:${nick}`)
      return mapOrderRow(v, raw, blocked)
    })
    orderRows.sort((a, b) =>
      String(b.orderTime ?? '').localeCompare(String(a.orderTime ?? '')),
    )

    const orderNos = scopedCoreViews
      .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId || v.bizOrderId || v.orderId)
      .filter(Boolean)
    const includedOrderNos = scopedCoreViews
      .filter((v) => v.includedInGmv)
      .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId || v.bizOrderId || v.orderId)
      .filter(Boolean)
    const excludedOrderNos = scopedCoreViews
      .filter((v) => !v.includedInGmv)
      .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId || v.bizOrderId || v.orderId)
      .filter(Boolean)

    const ordersTotal = orderRows.length
    const orders = orderRows.slice((page - 1) * pageSize, page * pageSize)

    const result: BoardLiveQueryResult = {
      requestId,
      preset: params.preset,
      startDate,
      endDate,
      source: 'live_api',
      isFromCache: false,
      fetchedAt: new Date().toISOString(),
      progress: {
        totalPages: totalPageEstimate,
        fetchedPages,
        totalOrders,
        message: '数据刷新完成',
      },
      summary,
      anchorPerformanceSummary,
      anchorLeaderboard: anchorLeaderboard as unknown as Array<Record<string, unknown>>,
      orders,
      allOrders: orderRows,
      ordersTotal,
      page,
      pageSize,
      blacklistedBuyerIds,
      debug: {
        orderNos,
        includedOrderNos,
        excludedOrderNos,
        gmvField: 'merchantReceivableAmount',
        formulaVersion: `live-query-no-snapshot-v1/${AMOUNT_FORMULA_VERSION}`,
      },
      unmatchedAfterSaleRecords: bundle.unmatchedAfterSaleRecords ?? [],
      fetchMeta: bundle.fetchMeta,
      qualityFeedback,
    }

    completeLiveQueryJob(requestId, result)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : '实时查询失败'
    failLiveQueryJob(requestId, message)
    throw err
  }
}

export function getBoardLiveQueryStatus(requestId: string) {
  const job = getLiveQueryJob(requestId)
  if (!job) return null
  return {
    requestId: job.requestId,
    status: job.status,
    progress: job.progress,
    error: job.error ?? null,
    data: job.status === 'success' ? job.result : undefined,
  }
}

export function startBoardLiveQueryAsync(params: BoardLiveQueryParams): string {
  const requestId = randomUUID()
  createLiveQueryJob(requestId)
  void executeBoardLiveQuery(params, requestId).catch(() => {
    /* failLiveQueryJob 已在 execute 内处理 */
  })
  return requestId
}
