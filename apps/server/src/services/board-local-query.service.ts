import { randomUUID } from 'node:crypto'

import type { AnalyzedOrderView } from '../types/analysis'

import {
  buildBusinessRangeKey,
  resolveBusinessRange,
  type BusinessRangePreset,
} from '../utils/business-range'

import {
  getOrBuildBusinessBoardCache,
  getBusinessBoardCache,
  isBusinessCacheWarmupRunning,
} from './business-cache.service'
import {
  filterViewsByAnchorSpec,
  getAnchorPerformanceViews,
} from './board-scoped-views.service'

import { aggregateAnchorLeaderboard } from './board-metrics.service'
import { ensureAnchorPerformanceLeaderboardSlots } from './anchor-performance-attribution.service'
import { enrichAnchorLeaderboardWithLateStatus } from './anchor-late-enrichment.service'
import { calculateBusinessMetrics } from './business-metrics.service'

import { AMOUNT_FORMULA_VERSION } from './order-amount-metrics.service'

import type { BoardLiveQueryResult, BoardLiveQueryPreset } from './board-live-query.service'

import { buildQualityFeedbackPublicStatus } from './quality-badcase-auto-sync.service'

import {

  getBusinessSyncStatus,

  handleLocalDataCoverageMissing,

} from './business-sync-scheduler.service'

import { prisma } from '../lib/prisma'

import type { UserRole } from '../types/roles'

import {

  filterViewsForStaffScope,

  isStaffUnbound,

  staffAnchorFilter,

  staffScopeMeta,

  STAFF_UNBOUND_MESSAGE,

} from './staff-anchor-scope.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'

import {
  boardCachePreparingMessage,
  boardDataDisplayStatusMessage,
  resolveBoardDataDisplayStatus,
  type BoardDataDisplayStatus,
} from './board-data-display-status.service'
import { logWarn } from '../utils/server-log'

function resolveLocalQueryRange(params: {
  preset: BoardLiveQueryPreset
  startDate?: string
  endDate?: string
}): { startDate: string; endDate: string } {
  const range = resolveBusinessRange(
    params.preset as BusinessRangePreset,
    params.startDate,
    params.endDate,
  )
  return {
    startDate: range.startDate,
    endDate: range.endDate,
  }
}

function logAnchorLeaderboardReconcile(
  summary: Record<string, unknown>,
  leaderboard: Array<Record<string, unknown>>,
  preset: string,
  startDate: string,
  endDate: string,
): void {
  const topGmvCent = Math.round(Number(summary.totalGmv ?? summary.gmv ?? 0) * 100)
  const topCount = Number(summary.orderCount ?? summary.paidOrderCount ?? 0)
  let cardsGmvCent = 0
  let cardsCount = 0
  for (const row of leaderboard) {
    cardsGmvCent += Math.round(Number(row.totalGmv ?? row.gmv ?? 0) * 100)
    cardsCount += Number(row.orderCount ?? row.paidOrderCount ?? 0)
  }
  const unassigned = leaderboard.find((r) => r.anchorName === '未归属')
  if (topGmvCent !== cardsGmvCent || topCount !== cardsCount) {
    const unassignedCount = unassigned ? Number(unassigned.orderCount ?? unassigned.paidOrderCount ?? 0) : 0
    const unassignedGmv = unassigned
      ? (Number(unassigned.totalGmv ?? unassigned.gmv ?? 0) / 100).toFixed(2)
      : '0.00'
    logWarn(
      '经营看板',
      `${preset} ${startDate}~${endDate} 主播卡片合计与顶部不一致：顶部支付 ¥${(topGmvCent / 100).toFixed(2)}/${topCount} 单，` +
        `卡片合计 ¥${(cardsGmvCent / 100).toFixed(2)}/${cardsCount} 单；` +
        `未归属 ${unassignedCount} 单、¥${unassignedGmv}`,
    )
  }
}

function buildSummaryFromViews(views: AnalyzedOrderView[]): Record<string, unknown> {
  const m = calculateBusinessMetrics(views)

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

    qualityReturnRate: m.qualityRefundRate,

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



function filterViewsByAnchor(
  views: AnalyzedOrderView[],
  anchorId?: string,
  anchorName?: string,
): AnalyzedOrderView[] {
  return filterViewsByAnchorSpec(views, anchorId, anchorName)
}



export async function executeBoardLocalQuery(params: {

  preset: BoardLiveQueryPreset

  startDate?: string

  endDate?: string

  anchorId?: string

  anchorName?: string

  page?: number

  pageSize?: number

  role?: UserRole

  username?: string

}): Promise<

  BoardLiveQueryResult & {

    syncMeta?: Awaited<ReturnType<typeof getBusinessSyncStatus>>

    dataDisplayStatus?: BoardDataDisplayStatus

  }

> {

  const requestId = randomUUID()

  const role = params.role

  const username = params.username ?? ''

  const { startDate, endDate } = resolveLocalQueryRange(params)
  const rangeKey = buildBusinessRangeKey(params.preset, startDate, endDate)
  const resolvedRange = {
    preset: params.preset,
    startDate,
    endDate,
  }

  const page = Math.max(1, params.page ?? 1)

  const pageSize = Math.min(5000, Math.max(1, params.pageSize ?? 20))



  const scopeMeta = role ? staffScopeMeta(role, username) : {}

  if (role && isStaffUnbound(role, username)) {

    const syncMeta = await getBusinessSyncStatus()

    return {

      requestId,

      preset: params.preset,

      startDate,

      endDate,

      rangeKey,

      resolvedRange,

      source: 'live_api',

      isFromCache: false,

      fetchedAt: syncMeta.businessSync.lastSuccessAt ?? new Date().toISOString(),

      dataDisplayStatus: 'empty',

      progress: {

        totalPages: 0,

        fetchedPages: 0,

        totalOrders: 0,

        message: STAFF_UNBOUND_MESSAGE,

      },

      summary: {},

      anchorPerformanceSummary: {},

      anchorLeaderboard: [],

      orders: [],

      allOrders: [],

      ordersTotal: 0,

      page,

      pageSize,

      blacklistedBuyerIds: [],

      debug: {

        orderNos: [],

        includedOrderNos: [],

        excludedOrderNos: [],

        gmvField: 'merchantReceivableAmount',

        formulaVersion: `local-db-v1/${AMOUNT_FORMULA_VERSION}`,

      },

      qualityFeedback: await buildQualityFeedbackPublicStatus(),

      syncMeta,

      ...scopeMeta,

    }

  }



  const forcedAnchor = role && username ? staffAnchorFilter(role, username) : undefined

  const anchorId = forcedAnchor ? undefined : params.anchorId

  const anchorName = forcedAnchor ?? params.anchorName



  let syncMeta = await getBusinessSyncStatus()

  const totalOrderCount = await prisma.xhsRawOrder.count()



  const qualityFeedback = await buildQualityFeedbackPublicStatus()

  const boardCache = await getOrBuildBusinessBoardCache({
    preset: params.preset,
    startDate,
    endDate,
  })

  const allViews = boardCache.views
  const rawByMatch = boardCache.rawByMatch

  const scopedAllViews = filterViewsForCoreMetrics(
    role && username ? filterViewsForStaffScope(allViews, role, username) : allViews,
  )
  const views = filterViewsByAnchor(scopedAllViews, anchorId, anchorName)

  const dataDisplayStatus = resolveBoardDataDisplayStatus({
    orderCountInRange: views.length,
    totalOrderCount,
    lastSuccessAt: syncMeta.businessSync.lastSuccessAt,
    syncStatus: syncMeta.businessSync.status,
  })

  if (
    dataDisplayStatus === 'syncing_no_cache' ||
    (views.length === 0 && totalOrderCount > 0 && syncMeta.businessSync.status === 'running')
  ) {
    void handleLocalDataCoverageMissing()
    syncMeta = await getBusinessSyncStatus()
  }

  const summary =
    views.length === boardCache.orderCount
      ? { ...boardCache.summary }
      : views.length > 0
        ? buildSummaryFromViews(views)
        : {}

  const performanceBaseViews =
    anchorId?.trim() || anchorName?.trim() ? views : scopedAllViews
  const performanceViews = await getAnchorPerformanceViews(
    performanceBaseViews,
    rawByMatch,
    anchorId,
    anchorName,
  )
  const anchorPerformanceSummary =
    performanceViews.length > 0 ? buildSummaryFromViews(performanceViews) : {}

  const anchorLeaderboardRaw = ensureAnchorPerformanceLeaderboardSlots(
    aggregateAnchorLeaderboard(performanceViews, {
      scope: 'local-query-anchor-performance',
      dateRange: { startDate, endDate, preset: params.preset },
    }) as import('./board-metrics.service').BoardAnchorMetrics[],
    endDate,
  ) as unknown as Array<Record<string, unknown>>

  const anchorLeaderboard = await enrichAnchorLeaderboardWithLateStatus(anchorLeaderboardRaw, {
    startDate,
    endDate,
    preset: params.preset,
  })

  logAnchorLeaderboardReconcile(
    anchorPerformanceSummary,
    anchorLeaderboard,
    params.preset,
    startDate,
    endDate,
  )

  const blacklistedBuyerIds = boardCache.blacklistedBuyerIds

  let progressMessage = boardDataDisplayStatusMessage(dataDisplayStatus)
  const cacheHit = Boolean(
    getBusinessBoardCache(params.preset, startDate, endDate),
  )
  if (
    isBusinessCacheWarmupRunning() &&
    !cacheHit &&
    views.length === 0 &&
    dataDisplayStatus !== 'syncing_no_cache'
  ) {
    progressMessage = boardCachePreparingMessage()
  }



  return {

    requestId,

    preset: params.preset,

    startDate,

    endDate,

    rangeKey,

    resolvedRange,

    source: 'live_api',
    isFromCache: true,

    fetchedAt:

      syncMeta.businessSync.lastSuccessAt ??

      syncMeta.businessSync.lastRunAt ??

      new Date().toISOString(),

    dataDisplayStatus,

    progress: {

      totalPages: views.length > 0 ? 1 : 0,

      fetchedPages: views.length > 0 ? 1 : 0,

      totalOrders: views.length,

      message: progressMessage,

    },

    summary,

    anchorPerformanceSummary,

    anchorLeaderboard: anchorLeaderboard as unknown as Array<Record<string, unknown>>,

    orders: [],

    allOrders: [],

    ordersTotal: views.length,

    page,

    pageSize,

    blacklistedBuyerIds,

    debug: {

      orderNos: [],

      includedOrderNos: [],

      excludedOrderNos: [],

      gmvField: 'merchantReceivableAmount',

      formulaVersion: `local-db-v1/${AMOUNT_FORMULA_VERSION}`,

    },

    qualityFeedback,

    syncMeta,

    ...(forcedAnchor ? { forcedAnchorName: forcedAnchor } : {}),

    ...scopeMeta,

  }

}


