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
  isBusinessBoardCachePendingBuild,
  isBusinessBoardCacheFingerprintStale,
  BUSINESS_CACHE_FINGERPRINT,
  buildBoardSummaryFromViews,
  type BusinessBoardCacheEntry,
} from './business-cache.service'
import {
  getAnchorPerformanceViews,
} from './board-scoped-views.service'

import { aggregateAnchorLeaderboard } from './board-metrics.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { remapViewsWithScheduleOverlay } from './anchor-schedule-attribution.service'
import { ensureAnchorPerformanceLeaderboardSlots } from './anchor-performance-attribution.service'
import { enrichAnchorLeaderboardWithLateStatus } from './anchor-late-enrichment.service'
import { enrichAnchorLeaderboardWithTrend } from './anchor-card-trend.service'
import { readBoardPresetSnapshot, buildSnapshotBoardCacheStub } from './board-preset-snapshot.service'
import { resolveAfterSalesCompleteness } from './after-sales-completeness.service'

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
/** GET /api/board/local-data 默认不自动触发同步；仅当 AUTO_SYNC_ON_VIEW_MISSING=true 时排队经营同步任务（不直接请求平台 API） */

export type BoardLocalQueryMode = 'overview' | 'anchors' | 'full'

let cachedTotalOrderCount: { at: number; count: number } | null = null

async function getTotalOrderCountCached(): Promise<number> {
  const now = Date.now()
  if (cachedTotalOrderCount && now - cachedTotalOrderCount.at < 60_000) {
    return cachedTotalOrderCount.count
  }
  const count = await prisma.xhsRawOrder.count()
  cachedTotalOrderCount = { at: now, count }
  return count
}

function buildSummaryFromViews(views: AnalyzedOrderView[]): Record<string, unknown> {
  return buildBoardSummaryFromViews(views)
}

function resolveDisplayOrderCount(
  hasAnchorFilter: boolean,
  performanceViews: AnalyzedOrderView[],
  scopedAllViews: AnalyzedOrderView[],
  boardCache: BusinessBoardCacheEntry,
): number {
  if (hasAnchorFilter) return performanceViews.length
  if (scopedAllViews.length > 0) return scopedAllViews.length
  if (boardCache.orderCount > 0) return boardCache.orderCount
  return 0
}

function shouldUseBoardCacheSummary(
  boardCache: BusinessBoardCacheEntry,
  scopedViewCount: number,
  hasAnchorFilter: boolean,
): boolean {
  if (hasAnchorFilter || boardCache.stale) return false
  if (scopedViewCount === boardCache.orderCount) return true
  // 磁盘快照占位：views 未加载，但 summary/orderCount 仍有效
  if (
    scopedViewCount === 0 &&
    boardCache.orderCount > 0 &&
    boardCache.summary &&
    Object.keys(boardCache.summary).length > 0
  ) {
    return true
  }
  return false
}

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
      ? Number(unassigned.totalGmv ?? unassigned.gmv ?? 0).toFixed(2)
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

function resolveQueryMode(params: {
  queryMode?: BoardLocalQueryMode
  includeAnchorLeaderboard?: boolean
}): BoardLocalQueryMode {
  if (params.queryMode) return params.queryMode
  if (params.includeAnchorLeaderboard === false) return 'overview'
  return 'full'
}

export async function executeBoardOverviewQuery(
  params: Omit<Parameters<typeof executeBoardLocalQuery>[0], 'queryMode' | 'includeAnchorLeaderboard'>,
) {
  return executeBoardLocalQuery({ ...params, queryMode: 'overview' })
}

export async function executeBoardAnchorsQuery(
  params: Omit<Parameters<typeof executeBoardLocalQuery>[0], 'queryMode' | 'includeAnchorLeaderboard'>,
) {
  return executeBoardLocalQuery({ ...params, queryMode: 'anchors' })
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

  /** 经营总览仅需 summary，跳过主播排行榜重算以加速响应 */
  includeAnchorLeaderboard?: boolean

  /** overview=总览轻量 / anchors=主播页 / full=兼容 local-data */
  queryMode?: BoardLocalQueryMode

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

  const includeAnchorLeaderboard = params.includeAnchorLeaderboard !== false
  const queryMode = resolveQueryMode(params)
  const needsAnchorPayload = queryMode === 'anchors' || queryMode === 'full'
  const includeAnchors = needsAnchorPayload && includeAnchorLeaderboard

  const hasAnchorFilter = Boolean(anchorId?.trim() || anchorName?.trim())

  let syncMeta = await getBusinessSyncStatus()

  const totalOrderCount = await getTotalOrderCountCached()

  const qualityFeedback = await buildQualityFeedbackPublicStatus()

  let boardCache = getBusinessBoardCache(params.preset, startDate, endDate)
  const canUseSnapshotFastPath =
    !hasAnchorFilter &&
    (queryMode === 'overview' || queryMode === 'anchors' || queryMode === 'full')

  /** 磁盘快照 / 指纹过期不得直接作为主播业绩事实来源 */
  const isAttributionStale = (entry: BusinessBoardCacheEntry | null | undefined): boolean => {
    if (!entry || entry.stale) return true
    if (entry.fallbackReason === 'disk_snapshot') return true
    return entry.attributionAlgorithmVersion !== BUSINESS_CACHE_FINGERPRINT
  }

  if (!boardCache && canUseSnapshotFastPath) {
    const snap = await readBoardPresetSnapshot(params.preset, startDate, endDate)
    if (snap) {
      boardCache = buildSnapshotBoardCacheStub(snap)
      void getOrBuildBusinessBoardCache({ preset: params.preset, startDate, endDate })
    }
  }

  if (boardCache && !isAttributionStale(boardCache)) {
    if (await isBusinessBoardCacheFingerprintStale(boardCache)) {
      boardCache = null
    }
  }

  if (!boardCache || isAttributionStale(boardCache)) {
    try {
      boardCache = await getOrBuildBusinessBoardCache({
        preset: params.preset,
        startDate,
        endDate,
      })
    } catch (err) {
      if (canUseSnapshotFastPath) {
        const snap = await readBoardPresetSnapshot(params.preset, startDate, endDate)
        if (snap) {
          boardCache = { ...buildSnapshotBoardCacheStub(snap), stale: true }
        }
      }
      if (!boardCache) throw err
    }
  }

  const isDiskSnapshot = boardCache.fallbackReason === 'disk_snapshot'
  const memoryHit = !isDiskSnapshot && Boolean(getBusinessBoardCache(params.preset, startDate, endDate))

  const allViews = boardCache.views
  const rawByMatch = boardCache.rawByMatch

  const scopedAllViews = filterViewsForCoreMetrics(
    role && username ? filterViewsForStaffScope(allViews, role, username) : allViews,
  )

  let performanceViews: AnalyzedOrderView[] = []
  let anchorPerformanceSummary: Record<string, unknown> = {}
  let anchorLeaderboard: Array<Record<string, unknown>> = []

  const needsPerformanceViews = includeAnchors || hasAnchorFilter

  if (needsPerformanceViews) {
    performanceViews = await getAnchorPerformanceViews(
      scopedAllViews,
      rawByMatch,
      hasAnchorFilter ? anchorId : undefined,
      hasAnchorFilter ? anchorName : undefined,
    )
  }

  const summarySourceViews = hasAnchorFilter ? performanceViews : scopedAllViews
  const displayOrderCount = resolveDisplayOrderCount(
    hasAnchorFilter,
    performanceViews,
    scopedAllViews,
    boardCache,
  )

  let dataDisplayStatus = resolveBoardDataDisplayStatus({
    orderCountInRange: displayOrderCount,
    totalOrderCount,
    lastSuccessAt: syncMeta.businessSync.lastSuccessAt,
    syncStatus: syncMeta.businessSync.status,
  })

  if (boardCache.stale) {
    dataDisplayStatus = 'failed_with_cache'
  } else if (
    displayOrderCount > 0 &&
    syncMeta.businessSync.status === 'failed'
  ) {
    dataDisplayStatus = syncMeta.businessSync.lastSuccessAt
      ? 'failed_with_cache'
      : 'ready'
  }

  if (
    AUTO_SYNC_ON_VIEW_MISSING &&
    (dataDisplayStatus === 'syncing_no_cache' ||
      (displayOrderCount === 0 && totalOrderCount > 0 && syncMeta.businessSync.status === 'running'))
  ) {
    void handleLocalDataCoverageMissing()
    syncMeta = await getBusinessSyncStatus()
  } else if (
    !AUTO_SYNC_ON_VIEW_MISSING &&
    dataDisplayStatus === 'syncing_no_cache'
  ) {
    const cachePreparing =
      isBusinessCacheWarmupRunning() ||
      isBusinessBoardCachePendingBuild(params.preset, startDate, endDate) ||
      isDiskSnapshot
    if (!cachePreparing) {
      dataDisplayStatus = 'coverage_missing'
    }
  } else if (
    !AUTO_SYNC_ON_VIEW_MISSING &&
    displayOrderCount === 0 &&
    totalOrderCount > 0 &&
    syncMeta.businessSync.status !== 'running' &&
    syncMeta.businessSync.status !== 'queued'
  ) {
    const cachePreparing =
      isBusinessCacheWarmupRunning() ||
      isBusinessBoardCachePendingBuild(params.preset, startDate, endDate) ||
      isDiskSnapshot
    if (!cachePreparing) {
      dataDisplayStatus = 'coverage_missing'
    }
  }

  let recalculatedSummary = shouldUseBoardCacheSummary(
    boardCache,
    scopedAllViews.length,
    hasAnchorFilter,
  )
    ? { ...boardCache.summary }
    : buildSummaryFromViews(summarySourceViews)

  const stableApplied = await applyLastMonthStableSummary({
    preset: params.preset,
    startDate,
    recalculatedSummary,
  })
  const summary = stableApplied.summary

  if (includeAnchors) {
    if (
      !hasAnchorFilter &&
      boardCache.enrichedAnchorLeaderboard &&
      boardCache.enrichedAnchorLeaderboard.length > 0
    ) {
      anchorLeaderboard = boardCache.enrichedAnchorLeaderboard
      anchorPerformanceSummary =
        boardCache.anchorPerformanceSummary ?? buildSummaryFromViews(performanceViews)
    } else {
      anchorPerformanceSummary = buildSummaryFromViews(performanceViews)
      const cacheLiveSessions = boardCache.liveSessions ?? []
      const remappedCoreViewsForQuality = await remapViewsWithScheduleOverlay(
        attachRawByMatchToViews(scopedAllViews, rawByMatch),
      )
      const anchorLeaderboardRaw = ensureAnchorPerformanceLeaderboardSlots(
        aggregateAnchorLeaderboard(
          performanceViews,
          {
            scope: 'local-query-anchor-performance',
            dateRange: { startDate, endDate, preset: params.preset },
          },
          { liveSessions: cacheLiveSessions, qualityRefundViews: remappedCoreViewsForQuality },
        ) as import('./board-metrics.service').BoardAnchorMetrics[],
        endDate,
      ) as unknown as Array<Record<string, unknown>>

      const anchorLeaderboardWithLate = await enrichAnchorLeaderboardWithLateStatus(
        anchorLeaderboardRaw,
        {
          startDate,
          endDate,
          preset: params.preset,
        },
      )

      anchorLeaderboard = await enrichAnchorLeaderboardWithTrend(
        anchorLeaderboardWithLate,
        performanceViews,
        { preset: params.preset, startDate, endDate },
      )
    }

    logAnchorLeaderboardReconcile(
      anchorPerformanceSummary,
      anchorLeaderboard,
      params.preset,
      startDate,
      endDate,
      boardCache.liveSessions ?? [],
    )
  }

  const blacklistedBuyerIds = boardCache.blacklistedBuyerIds

  let progressMessage = boardDataDisplayStatusMessage(dataDisplayStatus)
  const cacheHit = memoryHit || isDiskSnapshot

  const fullSyncMeta =
    queryMode === 'full' ? await buildBoardSyncMetaForApi() : undefined

  const overviewMeta =
    queryMode === 'anchors'
      ? undefined
      : await buildOverviewMeta({
          preset: params.preset,
          startDate,
          endDate,
          boardCache,
          businessCacheHit: cacheHit,
          dataDisplayStatus,
          lastQianfanSyncAt: syncMeta.businessSync.lastSuccessAt,
          stableContext: stableApplied.stableContext,
        })
  if (
    isBusinessCacheWarmupRunning() &&
    !cacheHit &&
    displayOrderCount === 0 &&
    dataDisplayStatus !== 'syncing_no_cache'
  ) {
    progressMessage = boardCachePreparingMessage()
  }

  if (displayOrderCount > 0 && syncMeta.businessSync.status === 'failed') {
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
    progressMessage = `缓存重建失败（${boardCache.buildError}），当前展示上一次成功缓存，数据可能未完成更新。`
  }

  const afterSalesCompleteness = await resolveAfterSalesCompleteness()
  if (
    afterSalesCompleteness.status === 'pending' ||
    afterSalesCompleteness.status === 'partial' ||
    afterSalesCompleteness.status === 'blocked'
  ) {
    progressMessage = `${progressMessage} ${afterSalesCompleteness.note}`.trim()
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
    isFromCache: cacheHit,

    fetchedAt:

      syncMeta.businessSync.lastSuccessAt ??

      syncMeta.businessSync.lastRunAt ??

      new Date().toISOString(),

    dataDisplayStatus,

    progress: {

      totalPages: displayOrderCount > 0 ? 1 : 0,

      fetchedPages: displayOrderCount > 0 ? 1 : 0,

      totalOrders: displayOrderCount,

      message: progressMessage,

    },

    summary,

    anchorPerformanceSummary,

    anchorLeaderboard: anchorLeaderboard as unknown as Array<Record<string, unknown>>,

    orders: [],

    allOrders: [],

    ordersTotal: displayOrderCount,

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

    afterSalesCompleteness,

    ...(fullSyncMeta ? { syncMeta: fullSyncMeta } : {}),

    ...(overviewMeta ? { overviewMeta } : {}),

    ...(forcedAnchor ? { forcedAnchorName: forcedAnchor } : {}),

    ...scopeMeta,

  }

}


