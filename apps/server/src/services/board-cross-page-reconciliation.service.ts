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
import type { BusinessDataGenerationSnapshot } from './business-data-generation.service'
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
const RATE_EPS = 0.0001

/** 与 BusinessDataGenerationSnapshot 全部 10 个 generation 字段顺序一致 */
const GENERATION_FIELDS = [
  'ordersGeneration',
  'liveSessionsGeneration',
  'settlementsGeneration',
  'workbenchGeneration',
  'timeSearchGeneration',
  'scheduleGeneration',
  'manualOverrideGeneration',
  'offlineDealGeneration',
  'anchorMasterGeneration',
  'qualityGeneration',
] as const satisfies ReadonlyArray<keyof BusinessDataGenerationSnapshot>

type StoredMap = Record<string, BoardReconciliationResult>

const REQUIRED_CORE_FIELDS = [
  'totalGmv',
  'orderCount',
  'validSalesAmount',
  'actualSignedAmount',
  'signedOrderCount',
  'awaitingSignCompletionAmount',
  'awaitingSignCompletionOrderCount',
  'returnAmount',
  'returnCount',
  'returnRate',
  'qualityReturnCount',
  'signRate',
] as const

type RequiredCoreField = (typeof REQUIRED_CORE_FIELDS)[number]

const FIELD_ALIASES: Record<RequiredCoreField, string[]> = {
  totalGmv: ['totalGmv', 'gmv'],
  orderCount: ['orderCount', 'paidOrderCount'],
  validSalesAmount: ['validSalesAmount', 'effectiveGmv'],
  actualSignedAmount: ['actualSignedAmount'],
  signedOrderCount: ['signedOrderCount', 'actualSignedCount'],
  awaitingSignCompletionAmount: ['awaitingSignCompletionAmount'],
  awaitingSignCompletionOrderCount: ['awaitingSignCompletionOrderCount'],
  returnAmount: ['returnAmount'],
  returnCount: ['returnCount'],
  returnRate: ['returnRate'],
  qualityReturnCount: ['qualityReturnCount'],
  signRate: ['signRate'],
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined
}

function fieldPresent(obj: Record<string, unknown>, field: RequiredCoreField): boolean {
  return FIELD_ALIASES[field].some((k) => hasOwn(obj, k))
}

function readPresentNumber(
  obj: Record<string, unknown>,
  keys: string[],
): { present: boolean; value: number } {
  for (const k of keys) {
    if (!hasOwn(obj, k)) continue
    const n = Number(obj[k])
    return { present: true, value: Number.isFinite(n) ? n : Number.NaN }
  }
  return { present: false, value: 0 }
}

function readPresentRate(
  obj: Record<string, unknown>,
  keys: string[],
): { present: boolean; value: number | null } {
  for (const k of keys) {
    if (!hasOwn(obj, k)) continue
    const raw = obj[k]
    if (raw === null) return { present: true, value: null }
    const n = Number(raw)
    if (!Number.isFinite(n)) return { present: true, value: null }
    return { present: true, value: n }
  }
  return { present: false, value: null }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function rateFromCounts(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

function ratesEqual(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(a - b) <= RATE_EPS
}

export function buildReconciliationStorageKey(
  preset: string,
  startDate: string,
  endDate: string,
): string {
  return `${preset}|${startDate}|${endDate}`
}

export function generationToken(entry: BusinessBoardCacheEntry): string | null {
  const g = entry.dataGeneration
  if (!g) return null
  return GENERATION_FIELDS.map((f) => Number((g as BusinessDataGenerationSnapshot)[f] ?? 0)).join(
    ':',
  )
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

function rateMismatch(
  metric: string,
  overviewValue: number | null,
  anchorValue: number | null,
): BoardReconciliationMismatch | null {
  if (ratesEqual(overviewValue, anchorValue)) return null
  const ov = overviewValue === null ? null : round2(overviewValue)
  const an = anchorValue === null ? null : round2(anchorValue)
  return {
    metric,
    overviewValue: ov,
    anchorValue: an,
    difference: ov === null || an === null ? null : round2(ov - an),
  }
}

function missingFieldMismatch(scope: string, field: string): BoardReconciliationMismatch {
  return {
    metric: `missing_metric_field:${scope}.${field}`,
    overviewValue: null,
    anchorValue: null,
    difference: null,
  }
}

/** 累加全部主播行（含线下专属 + 未归属），禁止按前端可见过滤 */
export function sumAnchorLeaderboardFacts(leaderboard: Array<Record<string, unknown>>): {
  totalGmv: number
  orderCount: number
  validSalesAmount: number
  actualSignedAmount: number
  signedOrderCount: number
  awaitingSignCompletionAmount: number
  awaitingSignCompletionOrderCount: number
  returnAmount: number
  returnCount: number
  qualityReturnCount: number
  returnRate: number | null
  signRate: number | null
} {
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
    const gmv = readPresentNumber(row, ['totalGmv', 'gmv'])
    const orders = readPresentNumber(row, ['orderCount', 'paidOrderCount'])
    const valid = readPresentNumber(row, ['validSalesAmount', 'effectiveGmv'])
    const signedAmt = readPresentNumber(row, ['actualSignedAmount'])
    const signedCnt = readPresentNumber(row, ['signedOrderCount', 'actualSignedCount'])
    const awaitingAmt = readPresentNumber(row, ['awaitingSignCompletionAmount'])
    const awaitingCnt = readPresentNumber(row, ['awaitingSignCompletionOrderCount'])
    const retAmt = readPresentNumber(row, ['returnAmount'])
    const retCnt = readPresentNumber(row, ['returnCount'])
    const quality = readPresentNumber(row, ['qualityReturnCount'])

    totalGmv += gmv.present ? gmv.value : 0
    orderCount += orders.present ? orders.value : 0
    validSalesAmount += valid.present ? valid.value : 0
    actualSignedAmount += signedAmt.present ? signedAmt.value : 0
    signedOrderCount += signedCnt.present ? signedCnt.value : 0
    awaitingSignCompletionAmount += awaitingAmt.present ? awaitingAmt.value : 0
    awaitingSignCompletionOrderCount += awaitingCnt.present ? awaitingCnt.value : 0
    returnAmount += retAmt.present ? retAmt.value : 0
    returnCount += retCnt.present ? retCnt.value : 0
    qualityReturnCount += quality.present ? quality.value : 0
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
    returnRate: rateFromCounts(returnCount, orderCount),
    signRate: rateFromCounts(signedOrderCount, orderCount),
  }
}

function collectMissingFields(
  scope: string,
  obj: Record<string, unknown>,
  mismatches: BoardReconciliationMismatch[],
): void {
  for (const field of REQUIRED_CORE_FIELDS) {
    if (!fieldPresent(obj, field)) {
      mismatches.push(missingFieldMismatch(scope, field))
    }
  }
}

export function reconcileBusinessBoardCacheEntry(
  entry: BusinessBoardCacheEntry,
): BoardReconciliationResult {
  const overview = (entry.summary ?? {}) as Record<string, unknown>
  const anchorSummary = (entry.anchorPerformanceSummary ?? overview) as Record<string, unknown>
  const leaderboard = entry.enrichedAnchorLeaderboard ?? entry.anchorLeaderboard ?? []
  const summed = sumAnchorLeaderboardFacts(leaderboard)
  const mismatches: BoardReconciliationMismatch[] = []

  collectMissingFields('overview', overview, mismatches)
  collectMissingFields('anchorPerformanceSummary', anchorSummary, mismatches)

  const moneyKeys: Array<{
    metric: Exclude<
      RequiredCoreField,
      'orderCount' | 'signedOrderCount' | 'awaitingSignCompletionOrderCount' | 'returnCount' | 'qualityReturnCount' | 'returnRate' | 'signRate'
    >
    aliases: string[]
  }> = [
    { metric: 'totalGmv', aliases: FIELD_ALIASES.totalGmv },
    { metric: 'validSalesAmount', aliases: FIELD_ALIASES.validSalesAmount },
    { metric: 'actualSignedAmount', aliases: FIELD_ALIASES.actualSignedAmount },
    {
      metric: 'awaitingSignCompletionAmount',
      aliases: FIELD_ALIASES.awaitingSignCompletionAmount,
    },
    { metric: 'returnAmount', aliases: FIELD_ALIASES.returnAmount },
  ]

  for (const row of moneyKeys) {
    const ov = readPresentNumber(overview, row.aliases)
    const an = readPresentNumber(anchorSummary, row.aliases)
    if (!ov.present || !an.present) continue
    const m1 = moneyMismatch(`${row.metric}(overview_vs_anchorSummary)`, ov.value, an.value)
    if (m1) mismatches.push(m1)
    const m2 = moneyMismatch(`${row.metric}(overview_vs_allAnchors)`, ov.value, summed[row.metric])
    if (m2) mismatches.push(m2)
  }

  const countKeys: Array<{
    metric: Extract<
      RequiredCoreField,
      | 'orderCount'
      | 'signedOrderCount'
      | 'awaitingSignCompletionOrderCount'
      | 'returnCount'
      | 'qualityReturnCount'
    >
    aliases: string[]
  }> = [
    { metric: 'orderCount', aliases: FIELD_ALIASES.orderCount },
    {
      metric: 'signedOrderCount',
      aliases: FIELD_ALIASES.signedOrderCount,
    },
    {
      metric: 'awaitingSignCompletionOrderCount',
      aliases: FIELD_ALIASES.awaitingSignCompletionOrderCount,
    },
    { metric: 'returnCount', aliases: FIELD_ALIASES.returnCount },
    {
      metric: 'qualityReturnCount',
      aliases: FIELD_ALIASES.qualityReturnCount,
    },
  ]

  for (const row of countKeys) {
    const ov = readPresentNumber(overview, row.aliases)
    const an = readPresentNumber(anchorSummary, row.aliases)
    if (!ov.present || !an.present) continue
    const m1 = countMismatch(`${row.metric}(overview_vs_anchorSummary)`, ov.value, an.value)
    if (m1) mismatches.push(m1)
    const m2 = countMismatch(
      `${row.metric}(overview_vs_allAnchors)`,
      ov.value,
      summed[row.metric],
    )
    if (m2) mismatches.push(m2)
  }

  const ovOrders = readPresentNumber(overview, FIELD_ALIASES.orderCount)
  const ovReturns = readPresentNumber(overview, FIELD_ALIASES.returnCount)
  const ovSigned = readPresentNumber(overview, FIELD_ALIASES.signedOrderCount)
  const anOrders = readPresentNumber(anchorSummary, FIELD_ALIASES.orderCount)
  const anReturns = readPresentNumber(anchorSummary, FIELD_ALIASES.returnCount)
  const anSigned = readPresentNumber(anchorSummary, FIELD_ALIASES.signedOrderCount)

  const ovReturnComputed =
    ovOrders.present && ovReturns.present
      ? rateFromCounts(ovReturns.value, ovOrders.value)
      : null
  const anReturnComputed =
    anOrders.present && anReturns.present
      ? rateFromCounts(anReturns.value, anOrders.value)
      : null
  const ovSignComputed =
    ovOrders.present && ovSigned.present
      ? rateFromCounts(ovSigned.value, ovOrders.value)
      : null
  const anSignComputed =
    anOrders.present && anSigned.present
      ? rateFromCounts(anSigned.value, anOrders.value)
      : null

  const ovReturnStored = readPresentRate(overview, FIELD_ALIASES.returnRate)
  const anReturnStored = readPresentRate(anchorSummary, FIELD_ALIASES.returnRate)
  const ovSignStored = readPresentRate(overview, FIELD_ALIASES.signRate)
  const anSignStored = readPresentRate(anchorSummary, FIELD_ALIASES.signRate)

  if (ovReturnStored.present) {
    const m = rateMismatch(
      'returnRate(overview_stored_vs_computed)',
      ovReturnStored.value,
      ovReturnComputed,
    )
    if (m) mismatches.push(m)
  }
  if (anReturnStored.present) {
    const m = rateMismatch(
      'returnRate(anchorSummary_stored_vs_computed)',
      anReturnStored.value,
      anReturnComputed,
    )
    if (m) mismatches.push(m)
  }
  if (ovSignStored.present) {
    const m = rateMismatch(
      'signRate(overview_stored_vs_computed)',
      ovSignStored.value,
      ovSignComputed,
    )
    if (m) mismatches.push(m)
  }
  if (anSignStored.present) {
    const m = rateMismatch(
      'signRate(anchorSummary_stored_vs_computed)',
      anSignStored.value,
      anSignComputed,
    )
    if (m) mismatches.push(m)
  }

  if (ovReturnStored.present && anReturnStored.present) {
    const m = rateMismatch(
      'returnRate(overview_vs_anchorSummary)',
      ovReturnStored.value,
      anReturnStored.value,
    )
    if (m) mismatches.push(m)
  }
  if (ovSignStored.present && anSignStored.present) {
    const m = rateMismatch(
      'signRate(overview_vs_anchorSummary)',
      ovSignStored.value,
      anSignStored.value,
    )
    if (m) mismatches.push(m)
  }

  if (ovReturnStored.present) {
    const m = rateMismatch(
      'returnRate(overview_vs_allAnchors)',
      ovReturnStored.value,
      summed.returnRate,
    )
    if (m) mismatches.push(m)
  }
  if (ovSignStored.present) {
    const m = rateMismatch('signRate(overview_vs_allAnchors)', ovSignStored.value, summed.signRate)
    if (m) mismatches.push(m)
  }

  // online + offline 拆分：仅在字段齐全时校验，缺失不静默用 0 冒充
  const online = readPresentNumber(overview, ['onlineGmv'])
  const offline = readPresentNumber(overview, ['offlineGmv'])
  const total = readPresentNumber(overview, FIELD_ALIASES.totalGmv)
  if (online.present && offline.present && total.present) {
    const splitDiff = moneyMismatch(
      'totalGmv(online_plus_offline)',
      total.value,
      round2(online.value + offline.value),
    )
    if (splitDiff) mismatches.push(splitDiff)
  }

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
  const key = buildReconciliationStorageKey(result.preset, result.startDate, result.endDate)
  store[key] = result
  await setSetting(SETTING_KEY, JSON.stringify(store))
}

export async function getBoardReconciliationResult(
  preset: string,
  startDate: string,
  endDate: string,
): Promise<BoardReconciliationResult | null> {
  const store = await readStore()
  return store[buildReconciliationStorageKey(preset, startDate, endDate)] ?? null
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

function entryFingerprint(entry: BusinessBoardCacheEntry): string {
  return entry.attributionAlgorithmVersion || BUSINESS_CACHE_FINGERPRINT
}

function entryMetricsVersion(entry: BusinessBoardCacheEntry): string {
  return String(entry.summary?.metricsVersion ?? BUSINESS_METRICS_VERSION)
}

export function isStoredReconciliationCompatible(
  stored: BoardReconciliationResult,
  entry: BusinessBoardCacheEntry,
): boolean {
  if (stored.preset !== entry.preset) return false
  if (stored.startDate !== entry.startDate) return false
  if (stored.endDate !== entry.endDate) return false
  const gen = generationToken(entry)
  if (!gen || !stored.generation || gen !== stored.generation) return false
  if (stored.businessCacheFingerprint !== entryFingerprint(entry)) return false
  if (stored.businessMetricsVersion !== entryMetricsVersion(entry)) return false
  return true
}

function pendingPayload(entry: BusinessBoardCacheEntry | null): BoardReconciliationResult {
  return {
    status: 'pending',
    checkedAt: new Date().toISOString(),
    generation: entry ? generationToken(entry) : null,
    preset: entry?.preset ?? '',
    startDate: entry?.startDate ?? '',
    endDate: entry?.endDate ?? '',
    businessMetricsVersion: entry ? entryMetricsVersion(entry) : BUSINESS_METRICS_VERSION,
    businessCacheFingerprint: entry ? entryFingerprint(entry) : BUSINESS_CACHE_FINGERPRINT,
    cacheBuiltAt: entry?.lastBuiltAt ?? null,
    mismatches: [],
  }
}

/**
 * API 返回 reconciliation：
 * - custom：对当前 entry 只读 reconcile，禁止复用其它 custom 范围缓存
 * - 其它：仅当 stored 与当前 entry 在 preset/日期/完整 generation/指纹/指标版本全部一致时才返回 stored
 */
export function buildApiReconciliationPayload(
  stored: BoardReconciliationResult | null,
  entry: BusinessBoardCacheEntry | null,
): BoardReconciliationResult {
  if (!entry) return pendingPayload(null)

  if (entry.preset === 'custom') {
    return reconcileBusinessBoardCacheEntry(entry)
  }

  if (stored && isStoredReconciliationCompatible(stored, entry)) {
    return stored
  }

  return pendingPayload(entry)
}
