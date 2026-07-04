import type { BusinessBoardCacheEntry } from './business-cache.service'
import { prisma } from '../lib/prisma'
import { logInfo, logWarn } from '../utils/server-log'

export const STABLE_AMOUNT_THRESHOLD_YUAN = 100

export interface LastMonthStableContext {
  monthKey: string
  stableValidSalesAmount: number
  latestValidSalesAmount: number
  diffAmount: number
  needsManualUpdate: boolean
  stableCacheBuiltAt: string
  stableSourceSyncJobId: string | null
}

export function monthKeyFromStartDate(startDate: string): string {
  return startDate.slice(0, 7)
}

function summaryFieldsFromCache(entry: BusinessBoardCacheEntry): {
  totalGmv: number
  validSalesAmount: number
  orderCount: number
  refundAmount: number
  qualityReturnCount: number
} {
  const s = entry.summary
  return {
    totalGmv: Number(s.totalGmv ?? 0),
    validSalesAmount: Number(s.validSalesAmount ?? s.effectiveGmv ?? 0),
    orderCount: Number(s.orderCount ?? s.paidOrderCount ?? 0),
    refundAmount: Number(s.returnAmount ?? 0),
    qualityReturnCount: Number(s.qualityReturnCount ?? 0),
  }
}

export async function getOverviewMetricSnapshot(monthKey: string, preset = 'lastMonth') {
  try {
    return await prisma.overviewMetricSnapshot.findUnique({
      where: { monthKey_preset: { monthKey, preset } },
    })
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'P2021') return null
    throw err
  }
}

async function upsertSnapshotFromCache(entry: BusinessBoardCacheEntry): Promise<void> {
  const monthKey = monthKeyFromStartDate(entry.startDate)
  const fields = summaryFieldsFromCache(entry)
  const dataJson = JSON.stringify({
    summary: entry.summary,
    orderCount: entry.orderCount,
    sourceDataMaxTime: entry.sourceDataMaxTime,
  })

  try {
    await prisma.overviewMetricSnapshot.upsert({
      where: { monthKey_preset: { monthKey, preset: entry.preset } },
      create: {
        monthKey,
        preset: entry.preset,
        sourceSyncJobId: entry.sourceSyncJobId,
        cacheBuiltAt: new Date(entry.lastBuiltAt),
        ...fields,
        dataJson,
      },
      update: {
        sourceSyncJobId: entry.sourceSyncJobId,
        cacheBuiltAt: new Date(entry.lastBuiltAt),
        ...fields,
        dataJson,
      },
    })
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'P2021') return
    throw err
  }
}

/** 经营同步完成后：首次写入或差异 ≤100 元时自动更新上月稳定快照 */
export async function tryUpdateLastMonthSnapshotAfterSync(
  entry: BusinessBoardCacheEntry,
): Promise<void> {
  if (entry.preset !== 'lastMonth') return

  const monthKey = monthKeyFromStartDate(entry.startDate)
  const latestValid = summaryFieldsFromCache(entry).validSalesAmount
  const existing = await getOverviewMetricSnapshot(monthKey)

  if (!existing) {
    await upsertSnapshotFromCache(entry)
    logInfo('经营总览快照', `上月稳定版首次写入 ${monthKey} 有效成交额 ¥${latestValid.toFixed(2)}`)
    return
  }

  const diff = Math.abs(latestValid - existing.validSalesAmount)
  if (diff <= STABLE_AMOUNT_THRESHOLD_YUAN) {
    await upsertSnapshotFromCache(entry)
    logInfo(
      '经营总览快照',
      `上月稳定版已更新 ${monthKey} 有效成交额 ¥${latestValid.toFixed(2)}（差异 ¥${diff.toFixed(2)}）`,
    )
    return
  }

  logWarn(
    '经营总览快照',
    `上月稳定版未自动更新 ${monthKey}：稳定 ¥${existing.validSalesAmount.toFixed(2)} vs 最新 ¥${latestValid.toFixed(2)}（差 ¥${diff.toFixed(2)}），需手动确认`,
  )
}

/** 维护脚本 / 管理接口：强制用当前缓存覆盖稳定快照 */
export async function forceUpdateLastMonthStableSnapshot(): Promise<{
  monthKey: string
  validSalesAmount: number
  cacheBuiltAt: string
}> {
  const { buildAndSetBusinessBoardCache, getBusinessBoardCache } = await import(
    './business-cache.service'
  )
  const range = (await import('../utils/business-range')).resolveBusinessRange('lastMonth')
  await buildAndSetBusinessBoardCache({
    preset: 'lastMonth',
    startDate: range.startDate,
    endDate: range.endDate,
  })
  const entry = getBusinessBoardCache('lastMonth', range.startDate, range.endDate)
  if (!entry) {
    throw new Error('上月经营缓存构建失败')
  }
  await upsertSnapshotFromCache(entry)
  const monthKey = monthKeyFromStartDate(entry.startDate)
  const validSalesAmount = summaryFieldsFromCache(entry).validSalesAmount
  logInfo('经营总览快照', `上月稳定版已手动更新 ${monthKey} 有效成交额 ¥${validSalesAmount.toFixed(2)}`)
  return {
    monthKey,
    validSalesAmount,
    cacheBuiltAt: entry.lastBuiltAt,
  }
}

function snapshotToSummaryPatch(
  snapshot: NonNullable<Awaited<ReturnType<typeof getOverviewMetricSnapshot>>>,
): Record<string, unknown> {
  let extra: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(snapshot.dataJson) as { summary?: Record<string, unknown> }
    if (parsed.summary && typeof parsed.summary === 'object') {
      extra = parsed.summary
    }
  } catch {
    /* ignore */
  }
  return {
    ...extra,
    totalGmv: snapshot.totalGmv,
    gmv: snapshot.totalGmv,
    productGmv: snapshot.totalGmv,
    validSalesAmount: snapshot.validSalesAmount,
    effectiveGmv: snapshot.validSalesAmount,
    orderCount: snapshot.orderCount,
    paidOrderCount: snapshot.orderCount,
    returnAmount: snapshot.refundAmount,
    qualityReturnCount: snapshot.qualityReturnCount,
    _stableSnapshot: true,
    _stableSnapshotBuiltAt: snapshot.cacheBuiltAt.toISOString(),
  }
}

export async function applyLastMonthStableSummary(params: {
  preset: string
  startDate: string
  recalculatedSummary: Record<string, unknown>
}): Promise<{
  summary: Record<string, unknown>
  stableContext: LastMonthStableContext | null
}> {
  if (params.preset !== 'lastMonth') {
    return { summary: params.recalculatedSummary, stableContext: null }
  }

  const monthKey = monthKeyFromStartDate(params.startDate)
  const snapshot = await getOverviewMetricSnapshot(monthKey)
  const latestValid = Number(
    params.recalculatedSummary.validSalesAmount ??
      params.recalculatedSummary.effectiveGmv ??
      0,
  )

  if (!snapshot) {
    return { summary: params.recalculatedSummary, stableContext: null }
  }

  const stableValid = snapshot.validSalesAmount
  const diffAmount = Math.round((latestValid - stableValid) * 100) / 100
  const needsManualUpdate = Math.abs(diffAmount) > STABLE_AMOUNT_THRESHOLD_YUAN

  const stableContext: LastMonthStableContext = {
    monthKey,
    stableValidSalesAmount: stableValid,
    latestValidSalesAmount: latestValid,
    diffAmount,
    needsManualUpdate,
    stableCacheBuiltAt: snapshot.cacheBuiltAt.toISOString(),
    stableSourceSyncJobId: snapshot.sourceSyncJobId,
  }

  if (needsManualUpdate) {
    return {
      summary: snapshotToSummaryPatch(snapshot),
      stableContext,
    }
  }

  return {
    summary: params.recalculatedSummary,
    stableContext,
  }
}
