/**
 * 经营总览 / 主播业绩内存缓存：以数据准确和实时为第一优先级
 */
import type { AnalyzedOrderView, LiveSession } from '../types/analysis'
import { resolveBusinessRange, type BusinessRangePreset } from '../utils/business-range'
import type { DateRangePreset, DateRangeResolved } from '../utils/date-range'
import {
  aggregateAnchorLeaderboard,
  loadBoardArtifactsForRange,
  normalizeBoardPreset,
} from './board-metrics.service'
import { buildBlacklistedBuyerIds, calculateBusinessMetrics } from './business-metrics.service'
import { buildAnchorPerformanceViewsFromScopedViews } from './anchor-performance-views.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { remapViewsWithScheduleOverlay } from './anchor-schedule-attribution.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { prisma } from '../lib/prisma'
import { getLatestWorkbenchCacheUpdatedAt } from './xhs-after-sales-workbench.service'
import { logInfo, logWarn, presetLabel } from '../utils/server-log'
import { printStartupSummary } from './startup-summary.service'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'
import { CANONICAL_ATTRIBUTION_VERSION } from './canonical-order-attribution.service'

export const BUSINESS_CACHE_PRESETS: BusinessRangePreset[] = [
  'today',
  'yesterday',
  'thisWeek',
  'thisMonth',
  'lastMonth',
]

/** 同步/维护后会 invalidate；日常请求复用内存缓存，避免阻塞 HTTP */
export const BUSINESS_CACHE_ALWAYS_REBUILD = false

export interface BusinessBoardCacheEntry {
  cacheKey: string
  preset: string
  startDate: string
  endDate: string
  scope: string
  range: DateRangeResolved
  summary: Record<string, unknown>
  anchorLeaderboard: Array<Record<string, unknown>>
  views: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
  /** 构建缓存时的直播场次，供主播品退归属 */
  liveSessions: LiveSession[]
  blacklistedBuyerIds: string[]
  orderCount: number
  lastBuiltAt: string
  /** 构建时售后工作台 DB 最新 updatedAt，用于检测 resync 后失效 */
  workbenchCacheMaxUpdatedAt: string | null
  sourceSyncJobId: string | null
  sourceDataMaxTime: string | null
  /** 原始订单/直播/结算表 updatedAt 最大值，检测 rawJson/售后字段更新 */
  sourceRawMaxUpdatedAt: string | null
  /** 归属算法版本：版本 bump 后强制重建缓存 */
  attributionAlgorithmVersion: string
  buildDurationMs: number
  stale?: boolean
  buildError?: string | null
  fallbackReason?: string | null
}

const cache = new Map<string, BusinessBoardCacheEntry>()
const pendingBuilds = new Map<string, Promise<BusinessBoardCacheEntry>>()
let warmupPromise: Promise<void> | null = null
let warmupRunning = false
/** 串行化全量重建，避免启动/同步/品退等多处同时重建导致内存峰值或进程异常退出 */
let fullRebuildQueue: Promise<void> = Promise.resolve()

const rebuildLog: Array<{ at: string; reason: string; presetCount: number }> = []

export function getRecentBusinessCacheRebuilds(withinMs = 86_400_000): Array<{
  at: string
  reason: string
  presetCount: number
}> {
  const cutoff = Date.now() - withinMs
  return rebuildLog.filter((e) => Date.parse(e.at) >= cutoff)
}

export function isBusinessCacheWarmupRunning(): boolean {
  return warmupRunning
}

export function buildBusinessCacheKey(
  preset: string,
  startDate: string,
  endDate: string,
  scope = 'default',
): string {
  return `${scope}|${preset}|${startDate}|${endDate}`
}

export function getBusinessBoardCache(
  preset: string,
  startDate: string,
  endDate: string,
  scope = 'default',
): BusinessBoardCacheEntry | null {
  return cache.get(buildBusinessCacheKey(preset, startDate, endDate, scope)) ?? null
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
    refundOnlyCount: m.refundOnlyOrderCount,
    unknownRefundTypeCount: m.unknownRefundTypeOrderCount,
    returnRefundTypeIncomplete: m.returnRefundTypeIncomplete,
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

async function resolveLatestBusinessSyncJobId(): Promise<string | null> {
  const job = await prisma.xhsSyncJob.findFirst({
    where: {
      preset: 'daily_strategy',
      status: { in: ['success', 'partial_success', 'success_empty'] },
    },
    orderBy: { finishedAt: 'desc' },
    select: { id: true },
  })
  return job?.id ?? null
}

async function resolveSourceDataMaxTime(): Promise<string | null> {
  const agg = await prisma.xhsRawOrder.aggregate({ _max: { orderTime: true } })
  return agg._max.orderTime?.toISOString() ?? null
}

export async function resolveSourceRawMaxUpdatedAt(): Promise<string | null> {
  const [orderAgg, liveAgg, pendingAgg, settledAgg] = await Promise.all([
    prisma.xhsRawOrder.aggregate({ _max: { updatedAt: true } }),
    prisma.xhsRawLiveSession.aggregate({ _max: { updatedAt: true } }),
    prisma.xhsRawPendingSettlement.aggregate({ _max: { updatedAt: true } }),
    prisma.xhsRawSettledSettlement.aggregate({ _max: { updatedAt: true } }),
  ])
  const timestamps = [
    orderAgg._max.updatedAt,
    liveAgg._max.updatedAt,
    pendingAgg._max.updatedAt,
    settledAgg._max.updatedAt,
  ]
    .filter((d): d is Date => d != null)
    .map((d) => d.getTime())
  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function evictBusinessBoardCacheEntry(
  key: string,
  preset: string,
  startDate: string,
  endDate: string,
): void {
  cache.delete(key)
  pendingBuilds.delete(key)
  logInfo(
    '经营缓存',
    `已清理缓存条目：${presetLabel(preset)} ${startDate}~${endDate}`,
  )
}

function fallbackFromPreviousCache(
  previous: BusinessBoardCacheEntry,
  buildError: unknown,
): BusinessBoardCacheEntry {
  const message = buildError instanceof Error ? buildError.message : String(buildError)
  return {
    ...previous,
    stale: true,
    buildError: message,
    fallbackReason: 'build_failed',
  }
}

export async function buildAndSetBusinessBoardCache(params: {
  preset: string
  startDate?: string
  endDate?: string
  scope?: string
}): Promise<BusinessBoardCacheEntry> {
  const scope = params.scope ?? 'default'
  const started = Date.now()
  const businessPreset = params.preset as BusinessRangePreset
  const range = resolveBusinessRange(businessPreset, params.startDate, params.endDate)
  const datePreset = normalizeBoardPreset(params.preset) as DateRangePreset
  const key = buildBusinessCacheKey(params.preset, range.startDate, range.endDate, scope)
  const previous = cache.get(key)

  try {
    const { views, rawByMatch, artifacts, liveSessions } = await loadBoardArtifactsForRange(
      datePreset,
      range.startDate,
      range.endDate,
    )

    const coreViews = filterViewsForCoreMetrics(views)
    const remappedCoreViews = await remapViewsWithScheduleOverlay(
      attachRawByMatchToViews(coreViews, rawByMatch),
    )
    const performanceViews = await buildAnchorPerformanceViewsFromScopedViews(views, rawByMatch)

    const summary = buildSummaryFromViews(coreViews)
    const abnormalOrderCount = artifacts?.abnormalOrderCount ?? 0
    if (abnormalOrderCount > 0) {
      summary.abnormalOrderCount = abnormalOrderCount
      summary.dataWarning = `有 ${abnormalOrderCount} 笔订单时间异常，未计入本期统计`
    }

    const anchorLeaderboard = aggregateAnchorLeaderboard(performanceViews, undefined, {
      liveSessions,
      qualityRefundViews: remappedCoreViews,
    })
    if (
      Number(summary.qualityReturnCount ?? 0) > 0 &&
      liveSessions.length === 0
    ) {
      logWarn(
        '经营缓存',
        `${presetLabel(params.preset)} 有品退订单，但缺少直播场次，主播品退归属可能偏低。`,
      )
    }
    const blacklistedBuyerIds = [...buildBlacklistedBuyerIds(coreViews)]
    const sourceDataMaxTime = await resolveSourceDataMaxTime()
    const sourceRawMaxUpdatedAt = await resolveSourceRawMaxUpdatedAt()
    const workbenchCacheMaxUpdatedAt = (await getLatestWorkbenchCacheUpdatedAt())?.toISOString() ?? null

    const entry: BusinessBoardCacheEntry = {
      cacheKey: key,
      preset: params.preset,
      startDate: range.startDate,
      endDate: range.endDate,
      scope,
      range,
      summary,
      anchorLeaderboard: anchorLeaderboard as unknown as Array<Record<string, unknown>>,
      views,
      rawByMatch,
      liveSessions,
      blacklistedBuyerIds,
      orderCount: views.length,
      lastBuiltAt: new Date().toISOString(),
      workbenchCacheMaxUpdatedAt,
      sourceSyncJobId: await resolveLatestBusinessSyncJobId(),
      sourceDataMaxTime,
      sourceRawMaxUpdatedAt,
      attributionAlgorithmVersion: CANONICAL_ATTRIBUTION_VERSION,
      buildDurationMs: Date.now() - started,
      stale: false,
      buildError: null,
      fallbackReason: null,
    }

    cache.set(entry.cacheKey, entry)
    logInfo(
      '经营缓存',
      `${presetLabel(params.preset)} 重新构建完成：${views.length} 单，用时 ${entry.buildDurationMs}ms，sourceDataMaxTime=${sourceDataMaxTime ?? '—'}`,
    )
    return entry
  } catch (e) {
    if (previous) {
      const fallback = fallbackFromPreviousCache(previous, e)
      logWarn(
        '经营缓存',
        `${presetLabel(params.preset)} 构建失败，回退旧缓存：${fallback.buildError}`,
      )
      return fallback
    }
    throw e
  }
}

export async function getOrBuildBusinessBoardCache(params: {
  preset: string
  startDate?: string
  endDate?: string
  scope?: string
  forceRebuild?: boolean
}): Promise<BusinessBoardCacheEntry> {
  await fullRebuildQueue

  const range = resolveBusinessRange(
    params.preset as BusinessRangePreset,
    params.startDate,
    params.endDate,
  )
  const scope = params.scope ?? 'default'
  const key = buildBusinessCacheKey(params.preset, range.startDate, range.endDate, scope)

  if (BUSINESS_CACHE_ALWAYS_REBUILD || params.forceRebuild) {
    const pending = pendingBuilds.get(key)
    if (pending) return pending
    const buildPromise = buildAndSetBusinessBoardCache({
      preset: params.preset,
      startDate: range.startDate,
      endDate: range.endDate,
      scope,
    })
      .catch((err) => {
        const hit = cache.get(key)
        if (hit) return fallbackFromPreviousCache(hit, err)
        throw err
      })
      .finally(() => {
        pendingBuilds.delete(key)
      })
    pendingBuilds.set(key, buildPromise)
    return buildPromise
  }

  const hit = cache.get(key)
  if (hit && !params.forceRebuild) {
    if (hit.attributionAlgorithmVersion !== CANONICAL_ATTRIBUTION_VERSION) {
      logInfo(
        '经营缓存',
        `${presetLabel(params.preset)} 归属算法版本变更（${hit.attributionAlgorithmVersion ?? '—'} → ${CANONICAL_ATTRIBUTION_VERSION}），重建经营缓存`,
      )
    } else {
    const latestSourceMax = await resolveSourceDataMaxTime()
    const latestRawMax = await resolveSourceRawMaxUpdatedAt()
    const latestSyncJobId = await resolveLatestBusinessSyncJobId()
    if (hit.sourceDataMaxTime !== latestSourceMax) {
      logInfo(
        '经营缓存',
        `${presetLabel(params.preset)} 订单库有更新（${hit.sourceDataMaxTime ?? '—'} → ${latestSourceMax ?? '—'}），重建经营缓存`,
      )
    } else if (hit.sourceRawMaxUpdatedAt !== latestRawMax) {
      logInfo(
        '经营缓存',
        `${presetLabel(params.preset)} 原始数据 updatedAt 有更新（${hit.sourceRawMaxUpdatedAt ?? '—'} → ${latestRawMax ?? '—'}），重建经营缓存`,
      )
    } else if (hit.sourceSyncJobId !== latestSyncJobId) {
      logInfo(
        '经营缓存',
        `${presetLabel(params.preset)} 同步任务已更新（${hit.sourceSyncJobId ?? '—'} → ${latestSyncJobId ?? '—'}），重建经营缓存`,
      )
    } else {
      const latestWorkbenchAt = await getLatestWorkbenchCacheUpdatedAt()
      const cachedWorkbenchAt = hit.workbenchCacheMaxUpdatedAt
        ? Date.parse(hit.workbenchCacheMaxUpdatedAt)
        : 0
      const latestMs = latestWorkbenchAt?.getTime() ?? 0
      if (latestMs <= cachedWorkbenchAt) {
        return hit
      }
      logInfo(
        '经营缓存',
        `${presetLabel(params.preset)} 售后工作台已更新，重建经营缓存`,
      )
    }
    }
  }
  const pending = pendingBuilds.get(key)
  if (pending) return pending

  const buildPromise = buildAndSetBusinessBoardCache({
    preset: params.preset,
    startDate: range.startDate,
    endDate: range.endDate,
    scope,
  })
    .catch((err) => {
      const hit = cache.get(key)
      if (hit) return fallbackFromPreviousCache(hit, err)
      throw err
    })
    .finally(() => {
      pendingBuilds.delete(key)
    })
  pendingBuilds.set(key, buildPromise)
  return buildPromise
}

export async function rebuildBusinessCacheForPresets(
  presets: BusinessRangePreset[] = BUSINESS_CACHE_PRESETS,
  options?: { allowSnapshotUpdate?: boolean },
): Promise<{ rebuilt: number; totalMs: number }> {
  const started = Date.now()
  let rebuilt = 0
  const uniquePresets = [...new Set(presets)]
  for (const preset of uniquePresets) {
    try {
      await buildAndSetBusinessBoardCache({ preset })
      rebuilt++
    } catch (e) {
      logWarn(
        '经营缓存',
        `${presetLabel(preset)} 构建失败：${e instanceof Error ? e.message : e}`,
      )
    }
  }
  const totalMs = Date.now() - started
  logInfo('经营缓存', `全量重建完成：${rebuilt} 个范围，总用时 ${totalMs}ms`)
  rebuildLog.unshift({
    at: new Date().toISOString(),
    reason: 'rebuildBusinessCacheForPresets',
    presetCount: rebuilt,
  })
  if (rebuildLog.length > 50) rebuildLog.length = 50

  const lastMonthRange = resolveBusinessRange('lastMonth')
  const lastMonthEntry = getBusinessBoardCache(
    'lastMonth',
    lastMonthRange.startDate,
    lastMonthRange.endDate,
  )
  if (options?.allowSnapshotUpdate && lastMonthEntry && !lastMonthEntry.stale) {
    const { tryUpdateLastMonthSnapshotAfterSync } = await import(
      './overview-metric-snapshot.service'
    )
    await tryUpdateLastMonthSnapshotAfterSync(lastMonthEntry).catch((err) => {
      logWarn(
        '经营总览快照',
        `上月快照写入失败：${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }

  return { rebuilt, totalMs }
}

function isPostBusinessSyncRebuildReason(reason: string): boolean {
  return /经营同步完成|API 同步完成|API 同步无订单/.test(reason)
}

function enqueueFullBusinessCacheRebuild(
  reason: string,
  options?: { invalidateFirst?: boolean; allowSnapshotUpdate?: boolean },
): Promise<void> {
  const invalidateFirst = options?.invalidateFirst ?? true
  const allowSnapshotUpdate =
    options?.allowSnapshotUpdate ?? isPostBusinessSyncRebuildReason(reason)
  const task = async (): Promise<void> => {
    if (invalidateFirst) {
      invalidateBusinessBoardCache()
      logInfo('经营缓存', `因「${reason}」触发全量重建`)
    } else {
      logInfo('经营缓存', reason)
    }
    await rebuildBusinessCacheForPresets(BUSINESS_CACHE_PRESETS, { allowSnapshotUpdate })
    rebuildLog.unshift({ at: new Date().toISOString(), reason, presetCount: BUSINESS_CACHE_PRESETS.length })
    if (rebuildLog.length > 50) rebuildLog.length = 50
  }
  const queued = fullRebuildQueue.then(task, task)
  fullRebuildQueue = queued.catch(() => {
    /* 队列继续，单次失败不阻断后续重建 */
  })
  return queued
}

export function getBusinessCacheWarmupPromise(): Promise<void> | null {
  return warmupPromise
}

export function warmupBusinessCacheOnBoot(): Promise<void> {
  if (warmupPromise) return warmupPromise
  warmupRunning = true
  warmupPromise = enqueueFullBusinessCacheRebuild('开始预热：今日/昨日/本周/本月/上月', {
    invalidateFirst: false,
  })
    .then(async () => {
      logInfo('经营缓存', '后台预热完成')
      await printStartupSummary()
    })
    .catch((e) => {
      logWarn('经营缓存', `预热失败：${e instanceof Error ? e.message : e}`)
    })
    .finally(() => {
      warmupRunning = false
    })
  return warmupPromise
}

export function getBusinessCacheDebugInfo(
  preset: string,
  startDate: string,
  endDate: string,
): {
  businessCacheHit: boolean
  businessCacheBuiltAt: string | null
  sourceSyncJobId: string | null
  cacheKey: string
  orderCount: number
} {
  const hit = getBusinessBoardCache(preset, startDate, endDate)
  return {
    businessCacheHit: Boolean(hit),
    businessCacheBuiltAt: hit?.lastBuiltAt ?? null,
    sourceSyncJobId: hit?.sourceSyncJobId ?? null,
    cacheKey: buildBusinessCacheKey(preset, startDate, endDate),
    orderCount: hit?.orderCount ?? 0,
  }
}

export function invalidateBusinessBoardCache(): void {
  cache.clear()
  pendingBuilds.clear()
  clearScheduleAttributionCache()
  logInfo('经营缓存', '已清空全部缓存条目')
}

function prewarmOperationsReportsAfterRebuild(reason: string): void {
  void import('./operations-report-cache.service').then(async (m) => {
    m.invalidateOperationsReportCache(reason)
    try {
      await m.prewarmOperationsReportCache(reason, { forceRebuild: true })
    } catch (err) {
      logWarn(
        '运营报表缓存',
        `同步后提前计算失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  })
}

/** 数据同步 / 维护后：先清空再按常用范围重建（与其他重建请求串行执行） */
export async function invalidateAndRebuildBusinessBoardCache(reason: string): Promise<void> {
  await enqueueFullBusinessCacheRebuild(reason)
  prewarmOperationsReportsAfterRebuild(reason)
}

/** 排班保存等场景：立即清空缓存，全量重建放入后台队列，避免 HTTP 超时 */
export function scheduleBusinessBoardCacheRebuild(reason: string): void {
  invalidateBusinessBoardCache()
  logInfo('经营缓存', `因「${reason}」触发后台全量重建`)
  void enqueueFullBusinessCacheRebuild(reason, { invalidateFirst: false })
  prewarmOperationsReportsAfterRebuild(reason)
}
