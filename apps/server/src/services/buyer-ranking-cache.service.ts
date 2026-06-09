import { prisma } from '../lib/prisma'
import { logInfo, logWarn } from '../utils/server-log'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { warmWorkbenchCacheForOrders } from './workbench-cache-warm.service'
import { processWorkbenchQueueBatch } from './xhs-after-sales-workbench.service'
import { buildBlacklistedBuyerIds } from './business-metrics.service'
import {
  buildBuyerRankingSummaryFromViews,
  buildBuyerRankingSampleMetaFromViews,
  type BuyerRankingItem,
  type BuyerRankingSampleMeta,
} from './buyer-ranking.service'
import { buildHighValueCustomerDefinition } from './buyer-ranking-classification'
import {
  buildBuyerDisplayLabel,
  buyerShortCodeFromKey,
  isStaleBuyerRankingKey,
} from './buyer-identity.service'
import { buildRawAnalyzeBundleAll } from './xhs-api-sync/xhs-analysis-from-raw.service'
import {
  attachRawByMatchToViews,
  filterViewsForBuyerRanking,
} from './low-price-brush-order.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'

const CACHE_ID = 'default'

/** building 超过此时间自动判定 stale 并释放锁 */
export const BUYER_RANKING_BUILDING_STALE_MS = 30 * 60 * 1000

/** 买家排行缓存版本：字段或身份规则变更时递增 */
export const BUYER_RANKING_CACHE_VERSION =
  'buyer_summary_unified_refund_v13_low_price_filter'

export interface BuyerRankingProfilePayload {
  source: 'buyer_profile_cache'
  cacheVersion: string
  expectedCacheVersion: string
  cacheCompatible: boolean
  items: BuyerRankingItem[]
  summary: {
    highValueCount: number
    repurchaseCount: number
    refundCount: number
    qualityHeavyCount: number
    blacklistCount: number
  }
  blacklistedBuyerIds: string[]
  updatedAt: string | null
  builtAt: string | null
  orderCount: number
  buyerCount: number
  lastTrigger: string | null
  cacheStale?: boolean
  cacheStaleReason?: string
  sampleMeta?: BuyerRankingSampleMeta
  highValueCustomerDefinition?: ReturnType<typeof buildHighValueCustomerDefinition>
}

let rebuildInProgress = false
let rebuildStartedAt: Date | null = null
let rebuildLastError: string | null = null
let rebuildTask: Promise<void> | null = null

export function isBuyerRankingCacheVersionCurrent(version: string | null | undefined): boolean {
  const v = String(version ?? '').trim()
  return v === BUYER_RANKING_CACHE_VERSION
}

function parseCacheVersionFromSummaryJson(summaryJson: string): string {
  try {
    const parsed = JSON.parse(summaryJson) as { cacheVersion?: string }
    return String(parsed.cacheVersion ?? '').trim()
  } catch {
    return ''
  }
}

export function parseBuyerRankingCacheVersionFromRow(row: {
  summaryJson: string
} | null): string {
  if (!row) return ''
  return parseCacheVersionFromSummaryJson(row.summaryJson)
}

export function isBuyerRankingCacheVersionStale(version: string | null | undefined): boolean {
  const v = String(version ?? '').trim()
  if (!v) return true
  if (v === BUYER_RANKING_CACHE_VERSION) return false
  if (v.startsWith(`${BUYER_RANKING_CACHE_VERSION}_`)) return true
  return v !== BUYER_RANKING_CACHE_VERSION
}

export function isBuyerRankingCacheRebuilding(): boolean {
  releaseStaleRebuildIfNeeded()
  return rebuildInProgress
}

export function releaseStaleRebuildIfNeeded(): boolean {
  if (!rebuildInProgress || !rebuildStartedAt) return false
  const elapsed = Date.now() - rebuildStartedAt.getTime()
  if (elapsed < BUYER_RANKING_BUILDING_STALE_MS) return false
  logWarn(
    '买家排行',
    `构建超时 ${Math.round(elapsed / 1000)} 秒，已自动释放任务锁`,
  )
  rebuildInProgress = false
  rebuildLastError = '买家画像生成超时，已自动释放任务锁，可稍后重试'
  rebuildStartedAt = null
  return true
}

export type BuyerProfileStatusKind =
  | 'ready'
  | 'stale_with_cache'
  | 'rebuilding'
  | 'empty'
  | 'failed'
  | 'stale'

export interface BuyerProfileStatusView {
  status: BuyerProfileStatusKind
  rebuilding: boolean
  startedAt: string | null
  updatedAt: string | null
  lastSuccessAt: string | null
  lastBuiltAt: string | null
  lastError: string | null
  durationMs: number | null
  runningSeconds: number | null
  isStaleRunning: boolean
  hasStaleCache: boolean
  cacheVersion: string | null
  expectedCacheVersion: string
  cacheCompatible: boolean
  rebuildScheduled: boolean
  sampleOrderCount: number
  sampleCustomerCount: number
  progress: number | null
  message: string
}

type BuyerRankingSyncMeta = {
  status: 'success' | 'failed' | 'running' | 'idle'
  lastError: string | null
}

function parseSampleCountsFromCacheRow(row: {
  summaryJson: string
  orderCount: number
  buyerCount: number
}): { sampleOrderCount: number; sampleCustomerCount: number } {
  try {
    const summaryParsed = JSON.parse(row.summaryJson) as {
      sampleMeta?: { sampleOrderCount?: number; sampleCustomerCount?: number }
    }
    return {
      sampleOrderCount: summaryParsed.sampleMeta?.sampleOrderCount ?? row.orderCount ?? 0,
      sampleCustomerCount: summaryParsed.sampleMeta?.sampleCustomerCount ?? row.buyerCount ?? 0,
    }
  } catch {
    return {
      sampleOrderCount: row.orderCount ?? 0,
      sampleCustomerCount: row.buyerCount ?? 0,
    }
  }
}

export function buildBuyerProfileStatusForApi(
  buyerCacheRow: {
    summaryJson: string
    orderCount: number
    buyerCount: number
    updatedAt: Date
  } | null,
  buyerRankingSync: BuyerRankingSyncMeta,
): BuyerProfileStatusView {
  const cacheVersion = parseBuyerRankingCacheVersionFromRow(buyerCacheRow)
  const versionStale = isBuyerRankingCacheVersionStale(cacheVersion)
  const cacheCompatible = isBuyerRankingCacheVersionCurrent(cacheVersion)

  const lastSuccessAt = buyerCacheRow?.updatedAt?.toISOString() ?? null
  const hasPhysicalCache = Boolean(
    buyerCacheRow && (buyerCacheRow.orderCount > 0 || buyerCacheRow.buyerCount > 0),
  )
  const hasStaleCache = hasPhysicalCache && cacheCompatible
  const counts = buyerCacheRow ? parseSampleCountsFromCacheRow(buyerCacheRow) : null
  const now = Date.now()
  const startedAtIso = rebuildStartedAt?.toISOString() ?? null
  const durationMs =
    rebuildInProgress && rebuildStartedAt ? now - rebuildStartedAt.getTime() : null
  const runningSeconds =
    durationMs != null ? Math.max(0, Math.floor(durationMs / 1000)) : null
  const isStaleRunning =
    rebuildInProgress &&
    rebuildStartedAt != null &&
    durationMs != null &&
    durationMs >= BUYER_RANKING_BUILDING_STALE_MS
  const rebuildScheduled = rebuildInProgress

  const statusBase = {
    rebuilding: rebuildInProgress,
    startedAt: rebuildInProgress ? startedAtIso : null,
    updatedAt: rebuildInProgress ? startedAtIso : lastSuccessAt,
    lastSuccessAt,
    durationMs,
    runningSeconds,
    hasStaleCache,
    cacheVersion: cacheVersion || null,
    expectedCacheVersion: BUYER_RANKING_CACHE_VERSION,
    cacheCompatible,
    rebuildScheduled,
    lastBuiltAt: lastSuccessAt,
    sampleOrderCount: counts?.sampleOrderCount ?? 0,
    sampleCustomerCount: counts?.sampleCustomerCount ?? 0,
    progress: null,
  }

  if (isStaleRunning) {
    releaseStaleRebuildIfNeeded()
    return {
      ...statusBase,
      status: 'stale',
      rebuilding: false,
      lastError: rebuildLastError ?? '买家画像更新可能已卡住',
      isStaleRunning: true,
      message: '买家画像更新可能已卡住，本次更新耗时较久，可以重新生成买家排行。',
    }
  }

  releaseStaleRebuildIfNeeded()

  if (rebuildInProgress) {
    return {
      ...statusBase,
      status: 'rebuilding',
      lastError: null,
      isStaleRunning: false,
      message: hasStaleCache
        ? '买家画像正在更新，当前展示最近一次画像结果。'
        : '买家画像正在更新，请稍候…',
    }
  }

  if (!buyerCacheRow) {
    const buyerSyncFailed = buyerRankingSync.status === 'failed'
    const errMsg = rebuildLastError ?? (buyerSyncFailed ? buyerRankingSync.lastError : '') ?? ''
    const failed = Boolean(rebuildLastError || (buyerSyncFailed && errMsg))
    return {
      ...statusBase,
      status: failed ? 'failed' : 'empty',
      rebuilding: false,
      startedAt: null,
      updatedAt: null,
      lastSuccessAt: null,
      durationMs: null,
      lastError: errMsg || null,
      runningSeconds: null,
      isStaleRunning: false,
      hasStaleCache: false,
      cacheVersion: null,
      cacheCompatible: false,
      rebuildScheduled: false,
      message: failed
        ? '买家画像更新失败，请检查订单和售后数据是否已同步，或稍后重试。'
        : '',
    }
  }

  if (rebuildLastError && !cacheCompatible && !hasPhysicalCache) {
    return {
      ...statusBase,
      status: 'failed',
      rebuilding: false,
      lastError: rebuildLastError,
      isStaleRunning: false,
      message: '买家画像更新失败，请检查订单和售后数据是否已同步，或稍后重试。',
    }
  }

  if ((versionStale || !cacheCompatible) && hasPhysicalCache && !rebuildInProgress) {
    return {
      ...statusBase,
      status: 'stale_with_cache',
      rebuilding: false,
      lastError: null,
      cacheCompatible: false,
      hasStaleCache: true,
      isStaleRunning: false,
      message: '买家画像正在更新，当前展示最近一次画像结果。',
    }
  }

  return {
    ...statusBase,
    status: 'ready',
    rebuilding: false,
    startedAt: null,
    updatedAt: lastSuccessAt,
    lastError: null,
    runningSeconds: null,
    isStaleRunning: false,
    message: '',
  }
}

function isStaleCacheItem(item: BuyerRankingItem): boolean {
  const buyerKey = String(item.buyerKey ?? item.buyerId ?? '').trim()
  const nickname = String(item.buyerNickname ?? item.nickname ?? '').trim()
  if (isStaleBuyerRankingKey(buyerKey, nickname)) return true
  if (!item.buyerKey) return true
  if (item.receivableAmount == null && item.statPaidAmount == null) return true
  if (item.refundSource && item.refundSource !== 'after_sales_workbench') return true
  if (!item.buyerDisplayLabel || item.buyerDisplayName === '未知买家') {
    const nick = String(item.buyerNickname ?? '').trim()
    if (nick && nick !== '未知买家') return true
  }
  if (item.refundCount == null && item.afterSaleCount == null && !item.buyerSummary) return true
  return false
}

function enrichBuyerRankingItem(item: BuyerRankingItem): BuyerRankingItem {
  const buyerKey = String(item.buyerKey ?? '').trim()
  const nick = String(item.buyerNickname ?? '').trim()
  const short =
    item.buyerShortCode?.trim() ||
    item.buyerIdentityCode?.trim() ||
    (buyerKey ? buyerShortCodeFromKey(buyerKey, item.buyerId) : '—')
  let buyerDisplayName = String(item.buyerDisplayName ?? item.nickname ?? '').trim()
  if (nick && (buyerDisplayName === '未知买家' || !buyerDisplayName)) {
    buyerDisplayName = nick
  }
  const buyerDisplayLabel =
    item.buyerDisplayLabel?.trim() ||
    buildBuyerDisplayLabel(buyerDisplayName, short)
  const summary = item.buyerSummary
  const refundCount = summary?.refundOrderCount ?? item.refundCount ?? item.refundTimes ?? 0
  const productRefundAmount = summary
    ? summary.refundAmountCent / 100
    : Number(item.productRefundAmount ?? item.refundAmount ?? 0)
  const qualityReturnCount =
    summary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
  const pendingAfterSaleOrderCount =
    summary?.pendingAfterSaleOrderCount ?? item.pendingAfterSaleOrderCount ?? 0
  return {
    ...item,
    buyerKey,
    buyerNickname: nick || item.buyerNickname,
    buyerDisplayName,
    buyerDisplayLabel,
    buyerShortCode: short,
    buyerIdentityCode: short,
    nickname: buyerDisplayName,
    refundCount,
    refundTimes: refundCount,
    productRefundAmount,
    refundAmount: productRefundAmount,
    qualityReturnCount,
    pendingAfterSaleOrderCount,
    afterSaleCount: item.afterSaleCount ?? item.refundRelatedOrderCount ?? 0,
    refundRelatedOrderCount: item.afterSaleCount ?? item.refundRelatedOrderCount ?? 0,
  }
}

export function isBuyerRankingCacheStale(items: BuyerRankingItem[]): {
  stale: boolean
  reason?: string
} {
  if (!items.length) return { stale: false }
  const sample = items.slice(0, 50)
  const bad = sample.filter((i) => isStaleCacheItem(i))
  if (bad.length > 0) {
    return {
      stale: true,
      reason: `缓存缺少 buyerKey 或仍使用昵称聚合（示例：${bad[0]?.nickname ?? bad[0]?.buyerId}）`,
    }
  }
  return { stale: false }
}

async function executeRebuildBuyerRankingCache(
  triggeredBy: string,
): Promise<{ updatedAt: string; buyerCount: number; orderCount: number }> {
  const started = Date.now()
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle || bundle.orders.length === 0) {
    throw new Error('本地无订单数据，请先同步订单后再更新买家排行')
  }

  const warmResult = await warmWorkbenchCacheForOrders(bundle.orders, {
    maxImmediateSync: 0,
  })
  if (warmResult.pending.length > 0) {
    await processWorkbenchQueueBatch(Math.min(200, warmResult.pending.length))
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const viewsWithRaw = attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch)
  const buyerRankingViews = filterViewsForBuyerRanking(filterViewsForCoreMetrics(viewsWithRaw))
  const { items, summary } = buildBuyerRankingSummaryFromViews(buyerRankingViews)
  const blacklistedBuyerIds = [...buildBlacklistedBuyerIds(buyerRankingViews)]
  const now = new Date()
  const sampleMeta = buildBuyerRankingSampleMetaFromViews(
    buyerRankingViews,
    now.toISOString(),
    bundle.orders,
  )

  const payloadMeta = {
    cacheVersion: BUYER_RANKING_CACHE_VERSION,
    builtAt: now.toISOString(),
    sampleMeta,
  }

  await prisma.buyerRankingCache.upsert({
    where: { id: CACHE_ID },
    create: {
      id: CACHE_ID,
      itemsJson: JSON.stringify(items),
      summaryJson: JSON.stringify({ ...summary, ...payloadMeta }),
      blacklistedBuyerIdsJson: JSON.stringify(blacklistedBuyerIds),
      orderCount: sampleMeta.sampleOrderCount,
      buyerCount: sampleMeta.sampleCustomerCount,
      builtAt: now,
      updatedAt: now,
      lastTrigger: `${triggeredBy}:${BUYER_RANKING_CACHE_VERSION}`,
    },
    update: {
      itemsJson: JSON.stringify(items),
      summaryJson: JSON.stringify({ ...summary, ...payloadMeta }),
      blacklistedBuyerIdsJson: JSON.stringify(blacklistedBuyerIds),
      orderCount: sampleMeta.sampleOrderCount,
      buyerCount: sampleMeta.sampleCustomerCount,
      updatedAt: now,
      lastTrigger: `${triggeredBy}:${BUYER_RANKING_CACHE_VERSION}`,
    },
  })

  logInfo(
    '买家排行',
    `重建完成：${items.length} 位买家，${buyerRankingViews.length} 单，用时 ${Date.now() - started}ms`,
  )

  return {
    updatedAt: now.toISOString(),
    buyerCount: sampleMeta.sampleCustomerCount,
    orderCount: sampleMeta.sampleOrderCount,
  }
}

/** 异步排队重建（不阻塞 GET）；同一时刻仅一个任务 */
export function scheduleBuyerRankingCacheRebuild(triggeredBy: string): boolean {
  releaseStaleRebuildIfNeeded()
  if (rebuildInProgress || rebuildTask) return false
  rebuildInProgress = true
  rebuildStartedAt = new Date()
  rebuildLastError = null
  logInfo('买家排行', `开始后台重建（触发：${triggeredBy}）`)
  rebuildTask = (async () => {
    try {
      await executeRebuildBuyerRankingCache(triggeredBy)
    } catch (err) {
      rebuildLastError = err instanceof Error ? err.message : '买家排行重建失败'
      logWarn(
        '买家排行',
        `自动重建失败：${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      rebuildInProgress = false
      rebuildStartedAt = null
      rebuildTask = null
    }
  })()
  return true
}

export async function rebuildBuyerRankingCache(
  triggeredBy = 'manual',
): Promise<{ updatedAt: string; buyerCount: number; orderCount: number }> {
  releaseStaleRebuildIfNeeded()
  if (rebuildInProgress) {
    throw new Error('买家排行正在更新中，请稍后再试')
  }
  rebuildInProgress = true
  rebuildStartedAt = new Date()
  rebuildLastError = null
  try {
    return await executeRebuildBuyerRankingCache(triggeredBy)
  } catch (err) {
    rebuildLastError = err instanceof Error ? err.message : '买家排行重建失败'
    throw err
  } finally {
    rebuildInProgress = false
    rebuildStartedAt = null
  }
}

export async function getBuyerRankingProfile(): Promise<BuyerRankingProfilePayload | null> {
  const row = await prisma.buyerRankingCache.findUnique({ where: { id: CACHE_ID } })
  if (!row) return null

  let items: BuyerRankingItem[] = []
  let summary = {
    highValueCount: 0,
    repurchaseCount: 0,
    refundCount: 0,
    qualityHeavyCount: 0,
    blacklistCount: 0,
  }
  let blacklistedBuyerIds: string[] = []
  let cacheVersion = ''
  let sampleMeta: BuyerRankingSampleMeta | undefined

  try {
    const summaryParsed = JSON.parse(row.summaryJson) as typeof summary & {
      cacheVersion?: string
      sampleMeta?: BuyerRankingSampleMeta
    }
    summary = summaryParsed
    cacheVersion = summaryParsed.cacheVersion ?? ''
    sampleMeta = summaryParsed.sampleMeta
    items = JSON.parse(row.itemsJson) as BuyerRankingItem[]
    blacklistedBuyerIds = JSON.parse(row.blacklistedBuyerIdsJson) as string[]
  } catch {
    return null
  }

  if (!sampleMeta) {
    try {
      const bundle = await buildRawAnalyzeBundleAll()
      const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
      const rawByMatch = new Map<string, Record<string, unknown>>()
      for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
        if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
      }
      const viewsWithRaw = attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch)
      const buyerRankingViews = filterViewsForBuyerRanking(filterViewsForCoreMetrics(viewsWithRaw))
      sampleMeta = buildBuyerRankingSampleMetaFromViews(
        buyerRankingViews,
        row.updatedAt.toISOString(),
        bundle?.orders,
      )
    } catch {
      // TODO: sampleMeta 需重建买家排行缓存后持久化
      sampleMeta = undefined
    }
  }

  const versionStale = isBuyerRankingCacheVersionStale(cacheVersion)
  const itemStale = isBuyerRankingCacheStale(items)
  const needsRebuild = versionStale || itemStale.stale
  const cacheCompatible = isBuyerRankingCacheVersionCurrent(cacheVersion) && !itemStale.stale

  if (needsRebuild && !rebuildInProgress && !rebuildTask) {
    logInfo('买家排行', '检测到缓存过期，排队自动重建')
    scheduleBuyerRankingCacheRebuild('auto_stale_cache')
  }

  const cacheReadable = items.length > 0 || row.orderCount > 0 || row.buyerCount > 0

  const itemsWithNickname = cacheReadable
    ? items.map((i) => {
        const productRefundAmount = Number(i.productRefundAmount ?? i.refundAmount ?? 0)
        return enrichBuyerRankingItem({
          ...i,
          refundAmount: productRefundAmount,
          productRefundAmount,
          refundSource: i.refundSource ?? 'after_sales_workbench',
        })
      })
    : []

  const emptySummary = {
    highValueCount: 0,
    repurchaseCount: 0,
    refundCount: 0,
    qualityHeavyCount: 0,
    blacklistCount: 0,
  }

  return {
    source: 'buyer_profile_cache',
    cacheVersion: cacheVersion || BUYER_RANKING_CACHE_VERSION,
    expectedCacheVersion: BUYER_RANKING_CACHE_VERSION,
    cacheCompatible,
    items: itemsWithNickname,
    summary: cacheReadable ? summary : emptySummary,
    blacklistedBuyerIds: cacheReadable ? blacklistedBuyerIds : [],
    updatedAt: row.updatedAt.toISOString(),
    builtAt: row.builtAt.toISOString(),
    orderCount: cacheReadable ? (sampleMeta?.sampleOrderCount ?? row.orderCount) : 0,
    buyerCount: cacheReadable ? (sampleMeta?.sampleCustomerCount ?? row.buyerCount) : 0,
    lastTrigger: row.lastTrigger,
    cacheStale: needsRebuild,
    cacheStaleReason: versionStale
      ? undefined
      : itemStale.reason,
    sampleMeta: cacheReadable ? sampleMeta : undefined,
    highValueCustomerDefinition: buildHighValueCustomerDefinition(),
  }
}

export async function ensureBuyerRankingCacheOnBoot(): Promise<void> {
  const existing = await prisma.buyerRankingCache.findUnique({ where: { id: CACHE_ID } })
  if (existing) {
    try {
      const summaryParsed = JSON.parse(existing.summaryJson) as { cacheVersion?: string }
      if (summaryParsed.cacheVersion === BUYER_RANKING_CACHE_VERSION) return
    } catch {
      /* rebuild */
    }
  } else if (!existing) {
    const orderCount = await prisma.xhsRawOrder.count()
    if (orderCount === 0) {
      logInfo('买家排行', '无订单，跳过首次构建')
      return
    }
  }
  try {
    await rebuildBuyerRankingCache(existing ? 'boot_stale' : 'boot')
  } catch (err) {
    logWarn(
      '买家排行',
      `启动时构建失败，已排队重试：${err instanceof Error ? err.message : String(err)}`,
    )
    scheduleBuyerRankingCacheRebuild(existing ? 'boot_stale_async' : 'boot_async')
  }
}

/** 官方品退同步后标记买家排行缓存需重建 */
export async function markBuyerRankingCacheStaleAfterQualitySync(): Promise<void> {
  const row = await prisma.buyerRankingCache.findUnique({ where: { id: CACHE_ID } })
  if (!row) return
  try {
    const summaryParsed = JSON.parse(row.summaryJson) as Record<string, unknown>
    if (summaryParsed.cacheVersion === BUYER_RANKING_CACHE_VERSION) {
      summaryParsed.cacheVersion = `${BUYER_RANKING_CACHE_VERSION}_pending_rebuild`
      await prisma.buyerRankingCache.update({
        where: { id: CACHE_ID },
        data: { summaryJson: JSON.stringify(summaryParsed), updatedAt: new Date() },
      })
      logInfo('买家排行', '品退同步后已标记排行缓存待重建')
    }
  } catch {
    // ignore
  }
}
