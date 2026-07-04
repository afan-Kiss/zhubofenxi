/**
 * 经营总览 / 主播业绩内存缓存：以数据准确和实时为第一优先级
 */
import type { AnalyzedOrderView } from '../types/analysis'
import { resolveBusinessRange, type BusinessRangePreset } from '../utils/business-range'
import type { DateRangePreset, DateRangeResolved } from '../utils/date-range'
import {
  aggregateAnchorLeaderboard,
  loadBoardArtifactsForRange,
  normalizeBoardPreset,
} from './board-metrics.service'
import { buildBlacklistedBuyerIds, calculateBusinessMetrics } from './business-metrics.service'
import {
  attachRawByMatchToViews,
  filterViewsForAnchorPerformance,
} from './low-price-brush-order.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { prisma } from '../lib/prisma'
import { getLatestWorkbenchCacheUpdatedAt } from './xhs-after-sales-workbench.service'
import { logInfo, logWarn, presetLabel } from '../utils/server-log'
import { printStartupSummary } from './startup-summary.service'

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
  blacklistedBuyerIds: string[]
  orderCount: number
  lastBuiltAt: string
  /** 构建时售后工作台 DB 最新 updatedAt，用于检测 resync 后失效 */
  workbenchCacheMaxUpdatedAt: string | null
  sourceSyncJobId: string | null
  sourceDataMaxTime: string | null
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
    const { views, rawByMatch, artifacts } = await loadBoardArtifactsForRange(
      datePreset,
      range.startDate,
      range.endDate,
    )

    const coreViews = filterViewsForCoreMetrics(views)
    const performanceViews = filterViewsForAnchorPerformance(
      attachRawByMatchToViews(coreViews, rawByMatch),
    )

    const summary = buildSummaryFromViews(coreViews)
    const abnormalOrderCount = artifacts?.abnormalOrderCount ?? 0
    if (abnormalOrderCount > 0) {
      summary.abnormalOrderCount = abnormalOrderCount
      summary.dataWarning = `有 ${abnormalOrderCount} 笔订单时间异常，未计入本期统计`
    }

    const anchorLeaderboard = aggregateAnchorLeaderboard(performanceViews)
    const blacklistedBuyerIds = [...buildBlacklistedBuyerIds(coreViews)]
    const sourceDataMaxTime = await resolveSourceDataMaxTime()
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
      blacklistedBuyerIds,
      orderCount: views.length,
      lastBuiltAt: new Date().toISOString(),
      workbenchCacheMaxUpdatedAt,
      sourceSyncJobId: await resolveLatestBusinessSyncJobId(),
      sourceDataMaxTime,
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
  return { rebuilt, totalMs }
}

function enqueueFullBusinessCacheRebuild(
  reason: string,
  options?: { invalidateFirst?: boolean },
): Promise<void> {
  const invalidateFirst = options?.invalidateFirst ?? true
  const task = async (): Promise<void> => {
    if (invalidateFirst) {
      invalidateBusinessBoardCache()
      logInfo('经营缓存', `因「${reason}」触发全量重建`)
    } else {
      logInfo('经营缓存', reason)
    }
    await rebuildBusinessCacheForPresets()
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
  logInfo('经营缓存', '已清空全部缓存条目')
}

function prewarmOperationsReportsAfterRebuild(): void {
  void import('./operations-report-cache.service').then((m) =>
    m.prewarmCommonOperationsReportsAfterBusinessSync().catch((err) => {
      logWarn(
        '运营报表缓存',
        `同步后提前计算失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }),
  )
}

/** 数据同步 / 维护后：先清空再按常用范围重建（与其他重建请求串行执行） */
export async function invalidateAndRebuildBusinessBoardCache(reason: string): Promise<void> {
  await enqueueFullBusinessCacheRebuild(reason)
  prewarmOperationsReportsAfterRebuild()
}

/** 排班保存等场景：立即清空缓存，全量重建放入后台队列，避免 HTTP 超时 */
export function scheduleBusinessBoardCacheRebuild(reason: string): void {
  invalidateBusinessBoardCache()
  logInfo('经营缓存', `因「${reason}」触发后台全量重建`)
  void enqueueFullBusinessCacheRebuild(reason, { invalidateFirst: false })
  prewarmOperationsReportsAfterRebuild()
}
