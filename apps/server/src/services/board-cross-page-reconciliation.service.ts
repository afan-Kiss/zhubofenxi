/**
 * 经营总览 ↔ 主播业绩 跨页对账（同一 BusinessBoardCacheEntry）
 * 禁止只累加前端可见主播行；必须含隐藏线下主播 + 未归属。
 */
import { BUSINESS_METRICS_VERSION } from './business-metrics.service'
import {
  BUSINESS_CACHE_FINGERPRINT,
  getBusinessBoardCache,
  type BusinessBoardCacheEntry,
} from './business-cache.service'
import { getSetting, setSetting } from './system-setting.service'
import { logInfo, logWarn } from '../utils/server-log'
import { resolveBusinessRange, type BusinessRangePreset } from '../utils/business-range'

export type BoardReconciliationStatus = 'pass' | 'failed' | 'pending'

export interface BoardReconciliationMismatch {
  metric: string
  overviewValue: number | null
  anchorValue: number | null
  difference: number | null
}

export interface BoardReconciliationResult {
  status: BoardReconciliationStatus
  checkedAt: string
  generation: string | null
  preset: string
  startDate: string
  endDate: string
  businessMetricsVersion: string
  businessCacheFingerprint: string
  cacheBuiltAt: string | null
  mismatches: BoardReconciliationMismatch[]
}

const SETTING_KEY = 'boardCrossPageReconciliation'
const MONEY_EPS = 0.01

type StoredMap = Record<string, BoardReconciliationResult>

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function generationToken(entry: BusinessBoardCacheEntry): string | null {
  const g = entry.dataGeneration
  if (!g) return null
  return [
    g.ordersGeneration,
    g.workbenchGeneration,
    g.timeSearchGeneration,
    g.scheduleGeneration,
    g.manualOverrideGeneration,
    g.offlineDealGeneration,
  ].join(':')
}

function moneyMismatch(
  metric: string,
  overviewValue: number,
  anchorValue: number,
): BoardReconciliationMismatch | null {
  const diff = round2(overviewValue - anchorValue)
  if (Math.abs(diff) <= MONEY_EPS) return null
  return {
    metric,
    overviewValue: round2(overviewValue),
    anchorValue: round2(anchorValue),
    difference: diff,
  }
}

function countMismatch(
  metric: string,
  overviewValue: number,
  anchorValue: number,
): BoardReconciliationMismatch | null {
  if (overviewValue === anchorValue) return null
  return {
    metric,
    overviewValue,
    anchorValue,
    difference: overviewValue - anchorValue,
  }
}

/** 累加全部主播行（含线下专属 + 未归属），禁止按前端可见过滤 */
export function sumAnchorLeaderboardFacts(
  leaderboard: Array<Record<string, unknown>>,
): Record<string, number> {
  let totalGmv = 0
  let orderCount = 0
  let validSalesAmount = 0
  let actualSignedAmount = 0
  let signedOrderCount = 0
  let awaitingSignCompletionAmount = 0
  let awaitingSignCompletionOrderCount = 0
  let returnAmount = 0
  let returnCount = 0
  let qualityReturnCount = 0

  for (const row of leaderboard) {
    totalGmv += num(row.totalGmv ?? row.gmv)
    orderCount += num(row.orderCount ?? row.paidOrderCount)
    validSalesAmount += num(row.validSalesAmount ?? row.effectiveGmv)
    actualSignedAmount += num(row.actualSignedAmount)
    signedOrderCount += num(row.signedOrderCount ?? row.actualSignedCount)
    awaitingSignCompletionAmount += num(row.awaitingSignCompletionAmount)
    awaitingSignCompletionOrderCount += num(row.awaitingSignCompletionOrderCount)
    returnAmount += num(row.returnAmount)
    returnCount += num(row.returnCount)
    qualityReturnCount += num(row.qualityReturnCount)
  }

  return {
    totalGmv: round2(totalGmv),
    orderCount,
    validSalesAmount: round2(validSalesAmount),
    actualSignedAmount: round2(actualSignedAmount),
    signedOrderCount,
    awaitingSignCompletionAmount: round2(awaitingSignCompletionAmount),
    awaitingSignCompletionOrderCount,
    returnAmount: round2(returnAmount),
    returnCount,
    qualityReturnCount,
  }
}

export function reconcileBusinessBoardCacheEntry(
  entry: BusinessBoardCacheEntry,
): BoardReconciliationResult {
  const overview = entry.summary ?? {}
  const anchorSummary = entry.anchorPerformanceSummary ?? overview
  const leaderboard = entry.enrichedAnchorLeaderboard ?? entry.anchorLeaderboard ?? []
  const summed = sumAnchorLeaderboardFacts(leaderboard)
  const mismatches: BoardReconciliationMismatch[] = []

  const moneyKeys: Array<{
    metric: string
    overview: number
    fromSummary: number
    fromCards: number
  }> = [
    {
      metric: 'totalGmv',
      overview: num(overview.totalGmv ?? overview.gmv),
      fromSummary: num(anchorSummary.totalGmv ?? anchorSummary.gmv),
      fromCards: summed.totalGmv,
    },
    {
      metric: 'validSalesAmount',
      overview: num(overview.validSalesAmount ?? overview.effectiveGmv),
      fromSummary: num(anchorSummary.validSalesAmount ?? anchorSummary.effectiveGmv),
      fromCards: summed.validSalesAmount,
    },
    {
      metric: 'actualSignedAmount',
      overview: num(overview.actualSignedAmount),
      fromSummary: num(anchorSummary.actualSignedAmount),
      fromCards: summed.actualSignedAmount,
    },
    {
      metric: 'awaitingSignCompletionAmount',
      overview: num(overview.awaitingSignCompletionAmount),
      fromSummary: num(anchorSummary.awaitingSignCompletionAmount),
      fromCards: summed.awaitingSignCompletionAmount,
    },
    {
      metric: 'returnAmount',
      overview: num(overview.returnAmount),
      fromSummary: num(anchorSummary.returnAmount),
      fromCards: summed.returnAmount,
    },
  ]

  for (const row of moneyKeys) {
    const m1 = moneyMismatch(
      `${row.metric}(overview_vs_anchorSummary)`,
      row.overview,
      row.fromSummary,
    )
    if (m1) mismatches.push(m1)
    const m2 = moneyMismatch(`${row.metric}(overview_vs_allAnchors)`, row.overview, row.fromCards)
    if (m2) mismatches.push(m2)
  }

  const countKeys: Array<{
    metric: string
    overview: number
    fromSummary: number
    fromCards: number
  }> = [
    {
      metric: 'orderCount',
      overview: num(overview.orderCount ?? overview.paidOrderCount),
      fromSummary: num(anchorSummary.orderCount ?? anchorSummary.paidOrderCount),
      fromCards: summed.orderCount,
    },
    {
      metric: 'signedOrderCount',
      overview: num(overview.signedOrderCount ?? overview.actualSignedCount),
      fromSummary: num(anchorSummary.signedOrderCount ?? anchorSummary.actualSignedCount),
      fromCards: summed.signedOrderCount,
    },
    {
      metric: 'awaitingSignCompletionOrderCount',
      overview: num(overview.awaitingSignCompletionOrderCount),
      fromSummary: num(anchorSummary.awaitingSignCompletionOrderCount),
      fromCards: summed.awaitingSignCompletionOrderCount,
    },
    {
      metric: 'returnCount',
      overview: num(overview.returnCount),
      fromSummary: num(anchorSummary.returnCount),
      fromCards: summed.returnCount,
    },
    {
      metric: 'qualityReturnCount',
      overview: num(overview.qualityReturnCount),
      fromSummary: num(anchorSummary.qualityReturnCount),
      fromCards: summed.qualityReturnCount,
    },
  ]

  for (const row of countKeys) {
    const m1 = countMismatch(
      `${row.metric}(overview_vs_anchorSummary)`,
      row.overview,
      row.fromSummary,
    )
    if (m1) mismatches.push(m1)
    const m2 = countMismatch(`${row.metric}(overview_vs_allAnchors)`, row.overview, row.fromCards)
    if (m2) mismatches.push(m2)
  }

  const ovOrders = num(overview.orderCount ?? overview.paidOrderCount)
  const ovReturns = num(overview.returnCount)
  const anOrders = num(anchorSummary.orderCount ?? anchorSummary.paidOrderCount)
  const anReturns = num(anchorSummary.returnCount)
  const ovRate = ovOrders > 0 ? ovReturns / ovOrders : 0
  const anRate = anOrders > 0 ? anReturns / anOrders : 0
  if (ovOrders !== anOrders || ovReturns !== anReturns) {
    mismatches.push({
      metric: 'returnRate(numerator_denominator)',
      overviewValue: round2(ovRate),
      anchorValue: round2(anRate),
      difference: round2(ovRate - anRate),
    })
  }

  const online = num(overview.onlineGmv)
  const offline = num(overview.offlineGmv)
  const total = num(overview.totalGmv ?? overview.gmv)
  const splitDiff = moneyMismatch('totalGmv(online_plus_offline)', total, round2(online + offline))
  if (splitDiff) mismatches.push(splitDiff)

  const checkedAt = new Date().toISOString()
  const generation = generationToken(entry)
  const status: BoardReconciliationStatus = mismatches.length === 0 ? 'pass' : 'failed'

  if (status === 'failed') {
    for (const m of mismatches) {
      logWarn(
        '跨页对账',
        `range=${entry.preset} ${entry.startDate}~${entry.endDate} generation=${generation ?? '-'} metric=${m.metric} overview=${m.overviewValue} anchor=${m.anchorValue} diff=${m.difference}`,
      )
    }
  } else {
    logInfo(
      '跨页对账',
      `pass preset=${entry.preset} ${entry.startDate}~${entry.endDate} generation=${generation ?? '-'}`,
    )
  }

  return {
    status,
    checkedAt,
    generation,
    preset: entry.preset,
    startDate: entry.startDate,
    endDate: entry.endDate,
    businessMetricsVersion: String(overview.metricsVersion ?? BUSINESS_METRICS_VERSION),
    businessCacheFingerprint: entry.attributionAlgorithmVersion || BUSINESS_CACHE_FINGERPRINT,
    cacheBuiltAt: entry.lastBuiltAt ?? null,
    mismatches,
  }
}

async function readStore(): Promise<StoredMap> {
  const raw = await getSetting(SETTING_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as StoredMap
  } catch {
    return {}
  }
}

export async function persistBoardReconciliationResult(
  result: BoardReconciliationResult,
): Promise<void> {
  const store = await readStore()
  store[result.preset] = result
  await setSetting(SETTING_KEY, JSON.stringify(store))
}

export async function getBoardReconciliationResult(
  preset: string,
): Promise<BoardReconciliationResult | null> {
  const store = await readStore()
  return store[preset] ?? null
}

export async function reconcileAndPersistCacheEntry(
  entry: BusinessBoardCacheEntry,
): Promise<BoardReconciliationResult> {
  const result = reconcileBusinessBoardCacheEntry(entry)
  await persistBoardReconciliationResult(result)
  return result
}

/** 经营缓存重建完成后：对指定 preset 跑轻量对账（无新定时任务） */
export async function runBoardCrossPageReconciliationForPresets(
  presets: string[],
): Promise<BoardReconciliationResult[]> {
  const out: BoardReconciliationResult[] = []
  const targets = [...new Set(presets)].filter((p) =>
    ['today', 'yesterday', 'thisMonth', 'lastMonth'].includes(p),
  )
  for (const preset of targets) {
    const range = resolveBusinessRange(preset as BusinessRangePreset)
    const entry = getBusinessBoardCache(preset, range.startDate, range.endDate)
    if (!entry || entry.stale || entry.fallbackReason === 'disk_snapshot') {
      const pending: BoardReconciliationResult = {
        status: 'pending',
        checkedAt: new Date().toISOString(),
        generation: entry ? generationToken(entry) : null,
        preset,
        startDate: range.startDate,
        endDate: range.endDate,
        businessMetricsVersion: BUSINESS_METRICS_VERSION,
        businessCacheFingerprint: BUSINESS_CACHE_FINGERPRINT,
        cacheBuiltAt: entry?.lastBuiltAt ?? null,
        mismatches: [],
      }
      await persistBoardReconciliationResult(pending)
      out.push(pending)
      continue
    }
    out.push(await reconcileAndPersistCacheEntry(entry))
  }
  return out
}

export function buildApiReconciliationPayload(
  stored: BoardReconciliationResult | null,
  entry: BusinessBoardCacheEntry | null,
): BoardReconciliationResult {
  if (stored) {
    const gen = entry ? generationToken(entry) : stored.generation
    if (gen && stored.generation && gen !== stored.generation) {
      return {
        ...stored,
        status: 'pending',
        generation: gen,
        mismatches: [],
        checkedAt: new Date().toISOString(),
      }
    }
    return stored
  }
  return {
    status: 'pending',
    checkedAt: new Date().toISOString(),
    generation: entry ? generationToken(entry) : null,
    preset: entry?.preset ?? '',
    startDate: entry?.startDate ?? '',
    endDate: entry?.endDate ?? '',
    businessMetricsVersion: BUSINESS_METRICS_VERSION,
    businessCacheFingerprint: BUSINESS_CACHE_FINGERPRINT,
    cacheBuiltAt: entry?.lastBuiltAt ?? null,
    mismatches: [],
  }
}
