import type { BusinessBoardCacheEntry } from './business-cache.service'
import type { BoardDataDisplayStatus } from './board-data-display-status.service'
import type { LastMonthStableContext } from './overview-metric-snapshot.service'
import { buildBusinessCacheKey } from './business-cache.service'
import { resolveLatestOrderTimeInRange } from './data-freshness.service'

export interface OverviewMeta {
  cacheKey: string
  cacheBuiltAt: string | null
  sourceSyncJobId: string | null
  sourceDataMaxTime: string | null
  businessCacheHit: boolean
  cacheStale: boolean
  fallbackReason: string | null
  dataVersionText: string
  recalculatedAt: string | null
  latestOrderTime: string | null
  lastQianfanSyncAt: string | null
  dataVersionId: string | null
  stableSnapshot?: {
    monthKey: string
    validSalesAmount: number
    cacheBuiltAt: string
    sourceSyncJobId: string | null
    label: string
  } | null
  stableVsLatest?: {
    stableValidSalesAmount: number
    latestValidSalesAmount: number
    diffAmount: number
    needsManualUpdate: boolean
    message: string | null
  } | null
}

function formatShanghaiShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function buildDataVersionText(params: {
  lastQianfanSyncAt: string | null
  cacheStale: boolean
  fallbackReason: string | null
  dataDisplayStatus: BoardDataDisplayStatus
}): string {
  if (params.fallbackReason === 'disk_snapshot') {
    return '重启后快速展示磁盘快照，后台正在重算完整数据。'
  }
  if (params.cacheStale && params.fallbackReason) {
    return `当前展示上一次成功缓存（${params.fallbackReason}），数据可能不是最新。`
  }
  if (params.cacheStale) {
    return '当前展示旧缓存，后台正在重新计算。'
  }
  if (params.dataDisplayStatus === 'coverage_missing') {
    return '当前范围暂无本地数据，请手动同步或等待定时同步。'
  }
  const syncLabel = formatShanghaiShort(params.lastQianfanSyncAt)
  if (syncLabel) {
    return `本页数据来自 ${syncLabel} 同步后的本地库。`
  }
  return '当前展示本地已同步数据，未直接请求千帆。'
}

function buildDataVersionId(
  boardCache: BusinessBoardCacheEntry,
  sourceSyncJobId: string | null,
): string | null {
  if (sourceSyncJobId) {
    return sourceSyncJobId.slice(-8)
  }
  if (boardCache.lastBuiltAt) {
    return boardCache.lastBuiltAt.replace(/[^\d]/g, '').slice(-10)
  }
  return null
}

export async function buildOverviewMeta(params: {
  preset: string
  startDate: string
  endDate: string
  boardCache: BusinessBoardCacheEntry
  businessCacheHit: boolean
  dataDisplayStatus: BoardDataDisplayStatus
  lastQianfanSyncAt: string | null
  stableContext: LastMonthStableContext | null
}): Promise<OverviewMeta> {
  const cacheKey = buildBusinessCacheKey(params.preset, params.startDate, params.endDate)
  const cacheBuiltAt = params.boardCache.lastBuiltAt ?? null
  const sourceSyncJobId = params.boardCache.sourceSyncJobId ?? null
  const cacheStale = Boolean(params.boardCache.stale)
  const fallbackReason = params.boardCache.fallbackReason ?? params.boardCache.buildError ?? null

  const latestOrderTime = await resolveLatestOrderTimeInRange(params.startDate, params.endDate)

  let stableSnapshot: OverviewMeta['stableSnapshot'] = null
  let stableVsLatest: OverviewMeta['stableVsLatest'] = null

  if (params.stableContext) {
    const ctx = params.stableContext
    const builtLabel = formatShanghaiShort(ctx.stableCacheBuiltAt) ?? ctx.stableCacheBuiltAt
    stableSnapshot = {
      monthKey: ctx.monthKey,
      validSalesAmount: ctx.stableValidSalesAmount,
      cacheBuiltAt: ctx.stableCacheBuiltAt,
      sourceSyncJobId: ctx.stableSourceSyncJobId,
      label: `上月稳定版 · 生成于 ${builtLabel}`,
    }
    stableVsLatest = {
      stableValidSalesAmount: ctx.stableValidSalesAmount,
      latestValidSalesAmount: ctx.latestValidSalesAmount,
      diffAmount: ctx.diffAmount,
      needsManualUpdate: ctx.needsManualUpdate,
      message: ctx.needsManualUpdate
        ? `检测到上月数据有变化：稳定版 ¥${ctx.stableValidSalesAmount.toFixed(2)}，最新重算 ¥${ctx.latestValidSalesAmount.toFixed(2)}，可手动更新稳定版。`
        : null,
    }
  }

  return {
    cacheKey,
    cacheBuiltAt,
    sourceSyncJobId,
    sourceDataMaxTime: params.boardCache.sourceDataMaxTime ?? null,
    businessCacheHit: params.businessCacheHit,
    cacheStale,
    fallbackReason,
    dataVersionText: buildDataVersionText({
      lastQianfanSyncAt: params.lastQianfanSyncAt,
      cacheStale,
      fallbackReason,
      dataDisplayStatus: params.dataDisplayStatus,
    }),
    recalculatedAt: cacheBuiltAt,
    latestOrderTime,
    lastQianfanSyncAt: params.lastQianfanSyncAt,
    dataVersionId: buildDataVersionId(params.boardCache, sourceSyncJobId),
    stableSnapshot,
    stableVsLatest,
  }
}
