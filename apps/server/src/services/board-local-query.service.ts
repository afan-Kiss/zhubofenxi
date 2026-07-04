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
import { enrichAnchorLeaderboardWithTrend } from './anchor-card-trend.service'
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
import { buildOverviewMeta, type OverviewMeta } from './overview-meta.service'
import {
  applyLastMonthStableSummary,
} from './overview-metric-snapshot.service'
import { buildBoardSyncMetaForApi } from './board-sync-meta.service'
import { logWarn } from '../utils/server-log'
import { getAllShopCookieHealth } from './shop-cookie-health.service'

const AUTO_SYNC_ON_VIEW_MISSING = process.env.AUTO_SYNC_ON_VIEW_MISSING === 'true'

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
  liveSessions: import('../types/analysis').LiveSession[] = [],
): void {
  const topGmvCent = Math.round(Number(summary.totalGmv ?? summary.gmv ?? 0) * 100)
  const topCount = Number(summary.orderCount ?? summary.paidOrderCount ?? 0)
  const summaryQuality = Number(summary.qualityReturnCount ?? 0)
  let cardsGmvCent = 0
  let cardsCount = 0
  let cardsQuality = 0
  for (const row of leaderboard) {
    cardsGmvCent += Math.round(Number(row.totalGmv ?? row.gmv ?? 0) * 100)
    cardsCount += Number(row.orderCount ?? row.paidOrderCount ?? 0)
    cardsQuality += Number(row.qualityReturnCount ?? 0)
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
  if (summaryQuality > 0 && cardsQuality === 0) {
    logWarn(
      '经营看板',
      `${preset} ${startDate}~${endDate} 品退总览有值(${summaryQuality})，但主播榜品退合计为 0，` +
        (liveSessions.length === 0
          ? '缺少直播场次，请检查 liveSessions 显式传入。'
          : '请检查品退归属逻辑。'),
    )
  }
  if (summaryQuality > 0 && liveSessions.length === 0) {
    logWarn(
      '经营看板',
      `${preset} ${startDate}~${endDate} 有品退订单(${summaryQuality})，但缺少直播场次，主播品退归属可能偏低。`,
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

    syncMeta?: Awaited<ReturnType<typeof buildBoardSyncMetaForApi>>

    dataDisplayStatus?: BoardDataDisplayStatus

    overviewMeta?: OverviewMeta

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

    const syncMeta = await buildBoardSyncMetaForApi()

    return {

      requestId,

      preset: params.preset,

      startDate,

      endDate,

      rangeKey,

      resolvedRange,

      source: 'local_db',

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

  let dataDisplayStatus = resolveBoardDataDisplayStatus({
    orderCountInRange: views.length,
    totalOrderCount,
    lastSuccessAt: syncMeta.businessSync.lastSuccessAt,
    syncStatus: syncMeta.businessSync.status,
  })

  if (boardCache.stale) {
    dataDisplayStatus = 'failed_with_cache'
  } else if (
    views.length > 0 &&
    syncMeta.businessSync.status === 'failed'
  ) {
    dataDisplayStatus = syncMeta.businessSync.lastSuccessAt
      ? 'failed_with_cache'
      : 'ready'
  }

  if (
    AUTO_SYNC_ON_VIEW_MISSING &&
    (dataDisplayStatus === 'syncing_no_cache' ||
      (views.length === 0 && totalOrderCount > 0 && syncMeta.businessSync.status === 'running'))
  ) {
    void handleLocalDataCoverageMissing()
    syncMeta = await getBusinessSyncStatus()
  } else if (
    !AUTO_SYNC_ON_VIEW_MISSING &&
    dataDisplayStatus === 'syncing_no_cache'
  ) {
    dataDisplayStatus = 'coverage_missing'
  } else if (
    !AUTO_SYNC_ON_VIEW_MISSING &&
    views.length === 0 &&
    totalOrderCount > 0 &&
    syncMeta.businessSync.status !== 'running' &&
    syncMeta.businessSync.status !== 'queued'
  ) {
    dataDisplayStatus = 'coverage_missing'
  }

  let recalculatedSummary =
    views.length === boardCache.orderCount && !boardCache.stale
      ? { ...boardCache.summary }
      : buildSummaryFromViews(views)

  const stableApplied = await applyLastMonthStableSummary({
    preset: params.preset,
    startDate,
    recalculatedSummary,
  })
  const summary = stableApplied.summary

  const performanceBaseViews =
    anchorId?.trim() || anchorName?.trim() ? views : scopedAllViews
  const performanceViews = await getAnchorPerformanceViews(
    performanceBaseViews,
    rawByMatch,
    anchorId,
    anchorName,
  )
  const anchorPerformanceSummary = buildSummaryFromViews(performanceViews)

  const cacheLiveSessions = boardCache.liveSessions ?? []
  const anchorLeaderboardRaw = ensureAnchorPerformanceLeaderboardSlots(
    aggregateAnchorLeaderboard(
      performanceViews,
      {
        scope: 'local-query-anchor-performance',
        dateRange: { startDate, endDate, preset: params.preset },
      },
      { liveSessions: cacheLiveSessions },
    ) as import('./board-metrics.service').BoardAnchorMetrics[],
    endDate,
  ) as unknown as Array<Record<string, unknown>>

  const anchorLeaderboardWithLate = await enrichAnchorLeaderboardWithLateStatus(anchorLeaderboardRaw, {
    startDate,
    endDate,
    preset: params.preset,
  })

  const anchorLeaderboard = await enrichAnchorLeaderboardWithTrend(
    anchorLeaderboardWithLate,
    performanceViews,
    { preset: params.preset, startDate, endDate },
  )

  logAnchorLeaderboardReconcile(
    anchorPerformanceSummary,
    anchorLeaderboard,
    params.preset,
    startDate,
    endDate,
    cacheLiveSessions,
  )

  const blacklistedBuyerIds = boardCache.blacklistedBuyerIds

  let progressMessage = boardDataDisplayStatusMessage(dataDisplayStatus)
  const cacheHit = Boolean(
    getBusinessBoardCache(params.preset, startDate, endDate),
  )

  const fullSyncMeta = await buildBoardSyncMetaForApi()

  const overviewMeta = await buildOverviewMeta({
    preset: params.preset,
    startDate,
    endDate,
    boardCache,
    businessCacheHit: cacheHit,
    dataDisplayStatus,
    lastQianfanSyncAt: fullSyncMeta.businessSync.lastSuccessAt,
    stableContext: stableApplied.stableContext,
  })
  if (
    isBusinessCacheWarmupRunning() &&
    !cacheHit &&
    views.length === 0 &&
    dataDisplayStatus !== 'syncing_no_cache'
  ) {
    progressMessage = boardCachePreparingMessage()
  }

  if (views.length > 0 && syncMeta.businessSync.status === 'failed') {
    const shopHealth = await getAllShopCookieHealth()
    const cookieBlocksSync = shopHealth.some(
      (h) => h.hasCookie && !h.ok,
    )
    if (cookieBlocksSync) {
      progressMessage =
        'Cookie 当前不可用，新数据同步失败；当前展示本地已同步数据。'
    }
  }

  if (boardCache.stale && boardCache.buildError) {
    progressMessage = `缓存重建失败（${boardCache.buildError}），当前展示上一次成功缓存。`
  }

  if (boardCache.stale || dataDisplayStatus === 'failed_with_cache') {
    logWarn(
      '经营看板',
      JSON.stringify({
        preset: params.preset,
        startDate,
        endDate,
        rangeKey,
        orderCount: summary.orderCount ?? 0,
        totalGmv: summary.totalGmv ?? 0,
        dataDisplayStatus,
        cacheHit,
        cacheStale: boardCache.stale ?? false,
        sourceDataMaxTime: boardCache.sourceDataMaxTime,
      }),
    )
  }



  return {

    requestId,

    preset: params.preset,

    startDate,

    endDate,

    rangeKey,

    resolvedRange,

    source: 'local_db',
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

    syncMeta: fullSyncMeta,

    overviewMeta,

    ...(forcedAnchor ? { forcedAnchorName: forcedAnchor } : {}),

    ...scopeMeta,

  }

}


