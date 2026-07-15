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
import {
  resolveAfterSalesCompleteness,
} from './after-sales-completeness.service'

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

  /** Wave4 SWR：有可展示 summary 且业务指纹兼容（或可信磁盘快照）即可立即返回 */
  const canServeDisplayCache = (
    entry: BusinessBoardCacheEntry | null | undefined,
  ): entry is BusinessBoardCacheEntry => {
    if (!entry?.summary || typeof entry.summary !== 'object') return false
    if (entry.attributionAlgorithmVersion === BUSINESS_CACHE_FINGERPRINT) return true
    // 磁盘快照：结构可用且指纹字段匹配当前版本时才秒开
    if (entry.fallbackReason === 'disk_snapshot') {
      return entry.attributionAlgorithmVersion === BUSINESS_CACHE_FINGERPRINT
    }
    return false
  }

  const needsBackgroundRebuild = async (
    entry: BusinessBoardCacheEntry,
  ): Promise<boolean> => {
    if (entry.fallbackReason === 'disk_snapshot') return true
    if (entry.stale) return true
    if (entry.buildError) return true
    if (await isBusinessBoardCacheFingerprintStale(entry)) return true
    return false
  }

  let cacheSource: 'memory' | 'snapshot' | 'rebuilt' | 'stale-fallback' = 'rebuilt'
  let updatingInBackground = false

  if (!boardCache && canUseSnapshotFastPath) {
    const snap = await readBoardPresetSnapshot(params.preset, startDate, endDate)
    if (snap) {
      const stub = buildSnapshotBoardCacheStub(snap)
      if (canServeDisplayCache(stub)) {
        boardCache = stub
        cacheSource = 'snapshot'
      }
    }
  }

  if (boardCache && canServeDisplayCache(boardCache)) {
    if (boardCache.fallbackReason === 'disk_snapshot') {
      cacheSource = 'snapshot'
    } else {
      cacheSource = 'memory'
    }
    if (await needsBackgroundRebuild(boardCache)) {
      updatingInBackground = true
      cacheSource = boardCache.fallbackReason === 'disk_snapshot' ? 'snapshot' : 'stale-fallback'
      void getOrBuildBusinessBoardCache({
        preset: params.preset,
        startDate,
        endDate,
        interactive: true,
      })
    }
  } else {
    boardCache = null
  }

  if (!boardCache) {
    try {
      boardCache = await getOrBuildBusinessBoardCache({
        preset: params.preset,
        startDate,
        endDate,
        interactive: true,
      })
      cacheSource = boardCache.fallbackReason === 'disk_snapshot' ? 'snapshot' : 'rebuilt'
      if (boardCache.stale || boardCache.fallbackReason === 'build_failed') {
        cacheSource = 'stale-fallback'
      }
    } catch (err) {
      if (canUseSnapshotFastPath) {
        const snap = await readBoardPresetSnapshot(params.preset, startDate, endDate)
        if (snap?.summary) {
          boardCache = {
            ...buildSnapshotBoardCacheStub(snap),
            stale: true,
            buildError: err instanceof Error ? err.message : String(err),
            fallbackReason: 'build_failed',
          }
          cacheSource = 'stale-fallback'
          updatingInBackground = false
        }
      }
      if (!boardCache) throw err
    }
  }

  const isDiskSnapshot = boardCache.fallbackReason === 'disk_snapshot'
  const memoryHit =
    cacheSource === 'memory' ||
    (cacheSource === 'stale-fallback' && !isDiskSnapshot)

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
      Array.isArray(boardCache.enrichedAnchorLeaderboard) &&
      (boardCache.enrichedAnchorLeaderboard.length > 0 ||
        isDiskSnapshot ||
        boardCache.views.length === 0)
    ) {
      anchorLeaderboard = boardCache.enrichedAnchorLeaderboard
      anchorPerformanceSummary =
        boardCache.anchorPerformanceSummary ??
        (boardCache.views.length > 0
          ? buildSummaryFromViews(performanceViews)
          : (boardCache.anchorPerformanceSummary ?? boardCache.summary))
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
    progressMessage = `当前展示上一次可信数据，后台更新失败。（${boardCache.buildError}）`
  } else if (updatingInBackground || isDiskSnapshot) {
    progressMessage = `${progressMessage} 当前展示上一次可信数据，后台更新中。`.trim()
  }

  const relevantViews = (boardCache.views ?? [])
    .map((v) => ({
      liveAccountId: String((v as { liveAccountId?: string }).liveAccountId ?? 'legacy'),
      orderNo: String(
        (v as { packageId?: string; orderId?: string; displayOrderNo?: string }).packageId ||
          (v as { orderId?: string }).orderId ||
          (v as { displayOrderNo?: string }).displayOrderNo ||
          '',
      ).trim(),
      payAmountYuan: Number((v as { gmv?: number; payAmount?: number }).gmv ?? 0) || 0,
      anchorId: (v as { anchorId?: string | null }).anchorId ?? null,
      anchorName: (v as { anchorName?: string | null }).anchorName ?? null,
      shopName: (v as { shopName?: string | null }).shopName ?? null,
    }))
    .filter((v) => v.orderNo)

  let afterSalesCompleteness: Awaited<ReturnType<typeof resolveAfterSalesCompleteness>>
  if (boardCache.afterSalesCompletenessSummary && (isDiskSnapshot || updatingInBackground)) {
    afterSalesCompleteness = {
      ...boardCache.afterSalesCompletenessSummary,
      scope: 'range',
    } as Awaited<ReturnType<typeof resolveAfterSalesCompleteness>>
  } else if (relevantViews.length === 0 && isDiskSnapshot) {
    // 快照无 views：勿误报「无支付订单」，用全局摘要填充
    const { resolveGlobalAfterSalesCompleteness } = await import(
      './after-sales-completeness.service'
    )
    const global = await resolveGlobalAfterSalesCompleteness()
    afterSalesCompleteness = {
      ...global,
      scope: 'range',
      note:
        global.globalPendingCount > 0
          ? `当前展示快照数据；全局另有 ${global.globalPendingCount} 笔售后待处理。`
          : '当前展示快照数据。',
    }
  } else {
    afterSalesCompleteness = await resolveAfterSalesCompleteness({
      startDate,
      endDate,
      relevantViews,
    })
  }
  // Wave4：首屏不再二次查询 global；由 range 结果附带 globalPendingCount
  const globalAfterSalesCompleteness =
    afterSalesCompleteness.scope === 'global'
      ? afterSalesCompleteness
      : {
          ...afterSalesCompleteness,
          scope: 'global' as const,
          note:
            afterSalesCompleteness.globalPendingCount > 0
              ? `全局另有 ${afterSalesCompleteness.globalPendingCount} 笔待处理（摘要）。`
              : '全局售后补查状态见范围摘要。',
        }
  if (
    afterSalesCompleteness.status === 'pending' ||
    afterSalesCompleteness.status === 'partial' ||
    afterSalesCompleteness.status === 'blocked' ||
    afterSalesCompleteness.status === 'failed'
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
    globalAfterSalesCompleteness,
    cacheStatus: {
      source: cacheSource,
      updatingInBackground,
      dataGeneration: boardCache.dataGeneration ?? null,
      lastBuiltAt: boardCache.lastBuiltAt,
      buildDurationMs: boardCache.buildDurationMs,
      attributionAlgorithmVersion: boardCache.attributionAlgorithmVersion,
    },

    ...(fullSyncMeta ? { syncMeta: fullSyncMeta } : {}),

    ...(overviewMeta ? { overviewMeta } : {}),

    ...(forcedAnchor ? { forcedAnchorName: forcedAnchor } : {}),

    ...scopeMeta,

  }

}


