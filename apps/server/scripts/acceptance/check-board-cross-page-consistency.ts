/**
 * 经营总览 ↔ 主播业绩 跨页一致性验收
 * npm run check:board-cross-page-consistency
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../../src/lib/prisma'
import {
  applyLastMonthStableSummary,
  STABLE_AMOUNT_THRESHOLD_YUAN,
} from '../../src/services/overview-metric-snapshot.service'
import {
  reconcileBusinessBoardCacheEntry,
  sumAnchorLeaderboardFacts,
  runBoardCrossPageReconciliationForPresets,
  buildApiReconciliationPayload,
  buildReconciliationStorageKey,
  generationToken,
  isStoredReconciliationCompatible,
  type BoardReconciliationResult,
} from '../../src/services/board-cross-page-reconciliation.service'
import type { BusinessBoardCacheEntry } from '../../src/services/business-cache.service'
import {
  buildAndSetBusinessBoardCache,
  getBusinessBoardCache,
  BUSINESS_CACHE_FINGERPRINT,
} from '../../src/services/business-cache.service'
import { executeBoardOverviewQuery, executeBoardAnchorsQuery } from '../../src/services/board-local-query.service'
import { resolveBusinessRange } from '../../src/utils/business-range'
import { BUSINESS_METRICS_VERSION } from '../../src/services/business-metrics.service'
import type { BusinessDataGenerationSnapshot } from '../../src/services/business-data-generation.service'

config({ path: path.resolve(__dirname, '../../.env') })

function fullGeneration(
  patch: Partial<BusinessDataGenerationSnapshot> = {},
): BusinessDataGenerationSnapshot {
  return {
    ordersGeneration: 1,
    liveSessionsGeneration: 1,
    settlementsGeneration: 1,
    workbenchGeneration: 1,
    timeSearchGeneration: 1,
    scheduleGeneration: 1,
    manualOverrideGeneration: 1,
    offlineDealGeneration: 1,
    anchorMasterGeneration: 1,
    qualityGeneration: 1,
    updatedAt: new Date().toISOString(),
    ...patch,
  }
}

function makeEntry(partial: Partial<BusinessBoardCacheEntry> & {
  summary: Record<string, unknown>
  anchorPerformanceSummary?: Record<string, unknown>
  enrichedAnchorLeaderboard?: Array<Record<string, unknown>>
}): BusinessBoardCacheEntry {
  const startDate = partial.startDate ?? '2026-08-11'
  const endDate = partial.endDate ?? '2026-08-11'
  return {
    cacheKey: 'test',
    preset: partial.preset ?? 'today',
    startDate,
    endDate,
    scope: 'default',
    range: {
      startDate,
      endDate,
      startTimeMs: 0,
      endTimeMs: 0,
    },
    summary: partial.summary,
    anchorLeaderboard: partial.enrichedAnchorLeaderboard ?? [],
    enrichedAnchorLeaderboard: partial.enrichedAnchorLeaderboard ?? [],
    anchorPerformanceSummary: partial.anchorPerformanceSummary ?? partial.summary,
    views: [],
    rawByMatch: new Map(),
    liveSessions: [],
    blacklistedBuyerIds: [],
    orderCount: Number(partial.summary.orderCount ?? 0),
    lastBuiltAt: new Date().toISOString(),
    workbenchCacheMaxUpdatedAt: null,
    timeSearchCacheMaxUpdatedAt: null,
    sourceSyncJobId: null,
    sourceDataMaxTime: null,
    sourceRawMaxUpdatedAt: null,
    attributionAlgorithmVersion: BUSINESS_CACHE_FINGERPRINT,
    buildDurationMs: 1,
    dataGeneration: fullGeneration(),
    ...partial,
  }
}

function baseRows() {
  const row = {
    anchorName: '子杰',
    totalGmv: 100,
    orderCount: 2,
    validSalesAmount: 90,
    actualSignedAmount: 80,
    signedOrderCount: 1,
    awaitingSignCompletionAmount: 10,
    awaitingSignCompletionOrderCount: 1,
    returnAmount: 5,
    returnCount: 1,
    qualityReturnCount: 0,
    returnRate: 0.5,
    signRate: 0.5,
  }
  const offline = {
    anchorName: '逸凡',
    systemKey: 'YIFAN_MANUAL',
    totalGmv: 30,
    orderCount: 1,
    validSalesAmount: 30,
    actualSignedAmount: 30,
    signedOrderCount: 1,
    awaitingSignCompletionAmount: 0,
    awaitingSignCompletionOrderCount: 0,
    returnAmount: 0,
    returnCount: 0,
    qualityReturnCount: 0,
    returnRate: 0,
    signRate: 1,
    offlineOnly: true,
  }
  const unassigned = {
    anchorName: '未归属',
    totalGmv: 20,
    orderCount: 1,
    validSalesAmount: 20,
    actualSignedAmount: 0,
    signedOrderCount: 0,
    awaitingSignCompletionAmount: 0,
    awaitingSignCompletionOrderCount: 0,
    returnAmount: 0,
    returnCount: 0,
    qualityReturnCount: 0,
    returnRate: 0,
    signRate: 0,
  }
  const refundHeavy = {
    anchorName: '小白',
    totalGmv: 50,
    orderCount: 1,
    validSalesAmount: 0,
    actualSignedAmount: 0,
    signedOrderCount: 0,
    awaitingSignCompletionAmount: 0,
    awaitingSignCompletionOrderCount: 0,
    returnAmount: 50,
    returnCount: 1,
    qualityReturnCount: 1,
    returnRate: 1,
    signRate: 0,
  }
  return [row, offline, unassigned, refundHeavy]
}

function baseSummary(): Record<string, unknown> {
  return {
    totalGmv: 200,
    onlineGmv: 170,
    offlineGmv: 30,
    unassignedGmv: 20,
    validSalesAmount: 140,
    orderCount: 5,
    actualSignedAmount: 110,
    signedOrderCount: 2,
    awaitingSignCompletionAmount: 10,
    awaitingSignCompletionOrderCount: 1,
    returnAmount: 55,
    returnCount: 2,
    qualityReturnCount: 1,
    returnRate: 0.4,
    signRate: 0.4,
    metricsVersion: BUSINESS_METRICS_VERSION,
  }
}

function testStableSnapshotNeverOverrides(): void {
  void STABLE_AMOUNT_THRESHOLD_YUAN
  console.log('  [unit] stable override guard defined (async covered in DB section)')
}

function testGenerationTokenIncludesAllTenFields(): void {
  const entry = makeEntry({
    summary: baseSummary(),
    enrichedAnchorLeaderboard: baseRows(),
    dataGeneration: fullGeneration({
      ordersGeneration: 2,
      liveSessionsGeneration: 3,
      settlementsGeneration: 4,
      workbenchGeneration: 5,
      timeSearchGeneration: 6,
      scheduleGeneration: 7,
      manualOverrideGeneration: 8,
      offlineDealGeneration: 9,
      anchorMasterGeneration: 10,
      qualityGeneration: 11,
    }),
  })
  const token = generationToken(entry)
  assert.equal(token, '2:3:4:5:6:7:8:9:10:11')
  assert.equal(token!.split(':').length, 10)
  console.log('  [unit] generationToken includes all 10 generation fields')
}

function testReconcilePassAndFail(): void {
  const allRows = baseRows()
  const summary = baseSummary()
  const pass = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: allRows,
    }),
  )
  assert.equal(pass.status, 'pass', `expected pass got ${JSON.stringify(pass.mismatches)}`)

  const fail = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: { ...summary, totalGmv: 999 },
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: allRows,
    }),
  )
  assert.equal(fail.status, 'failed')
  assert.ok(fail.mismatches.some((m) => m.metric.includes('totalGmv')))

  const visibleOnly = sumAnchorLeaderboardFacts([allRows[0]!, allRows[2]!, allRows[3]!])
  assert.notEqual(visibleOnly.totalGmv, summary.totalGmv)
  const summed = sumAnchorLeaderboardFacts(allRows)
  assert.equal(summed.totalGmv, 200)
  assert.equal(summed.orderCount, 5)
  assert.equal(summed.qualityReturnCount, 1)
  assert.equal(summed.awaitingSignCompletionAmount, 10)
  assert.equal(summed.returnRate, 0.4)
  assert.equal(summed.signRate, 0.4)
  console.log('  [unit] reconcile pass/fail + all-anchors sum OK')
}

function testAnchorRowIntegrityGate(): void {
  const summary = baseSummary()
  const rows = baseRows()

  // 正常多主播 PASS
  const ok = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: rows,
    }),
  )
  assert.equal(ok.status, 'pass', JSON.stringify(ok.mismatches))
  console.log('  [unit] normal multi-anchor rows PASS')

  // 缺 actualSignedAmount（真实值为 0）仍 FAIL
  const missingSigned = rows.map((r) => {
    if (r.anchorName !== '小白') return { ...r }
    const copy = { ...r, actualSignedAmount: 0 }
    delete (copy as { actualSignedAmount?: number }).actualSignedAmount
    return copy
  })
  const missSignedRes = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: missingSigned,
    }),
  )
  assert.equal(missSignedRes.status, 'failed')
  assert.ok(
    missSignedRes.mismatches.some(
      (m) => m.metric === 'missing_anchor_metric_field:小白.actualSignedAmount',
    ),
    JSON.stringify(missSignedRes.mismatches),
  )
  console.log('  [unit] missing actualSignedAmount (even if 0) => FAIL')

  // 缺 returnRate（飞云）
  const emptySummary = {
    totalGmv: 0,
    onlineGmv: 0,
    offlineGmv: 0,
    validSalesAmount: 0,
    orderCount: 0,
    actualSignedAmount: 0,
    signedOrderCount: 0,
    awaitingSignCompletionAmount: 0,
    awaitingSignCompletionOrderCount: 0,
    returnAmount: 0,
    returnCount: 0,
    qualityReturnCount: 0,
    returnRate: null,
    signRate: null,
    metricsVersion: BUSINESS_METRICS_VERSION,
  }
  const feiyunMissingReturnRate = {
    anchorName: '飞云',
    totalGmv: 0,
    orderCount: 0,
    validSalesAmount: 0,
    actualSignedAmount: 0,
    signedOrderCount: 0,
    awaitingSignCompletionAmount: 0,
    awaitingSignCompletionOrderCount: 0,
    returnAmount: 0,
    returnCount: 0,
    qualityReturnCount: 0,
    signRate: null as number | null,
  }
  const missReturnRateRes = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: emptySummary,
      anchorPerformanceSummary: emptySummary,
      enrichedAnchorLeaderboard: [feiyunMissingReturnRate],
    }),
  )
  assert.equal(missReturnRateRes.status, 'failed')
  assert.ok(
    missReturnRateRes.mismatches.some(
      (m) => m.metric === 'missing_anchor_metric_field:飞云.returnRate',
    ),
    JSON.stringify(missReturnRateRes.mismatches),
  )
  console.log('  [unit] missing returnRate => FAIL')

  // 主播 returnRate 与自身退款单数不符
  const badReturnRate = rows.map((r) =>
    r.anchorName === '小白' ? { ...r, returnRate: 0.2 } : { ...r },
  )
  const badReturnRes = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: badReturnRate,
    }),
  )
  assert.equal(badReturnRes.status, 'failed')
  assert.ok(
    badReturnRes.mismatches.some((m) => m.metric === 'anchor_rate_mismatch:小白.returnRate'),
    JSON.stringify(badReturnRes.mismatches),
  )
  console.log('  [unit] wrong anchor returnRate => FAIL')

  // 主播 signRate 与自身签收单数不符
  const withFeiyun = [
    ...rows.filter((r) => r.anchorName !== '逸凡'),
    {
      anchorName: '飞云',
      totalGmv: 30,
      orderCount: 1,
      validSalesAmount: 30,
      actualSignedAmount: 30,
      signedOrderCount: 1,
      awaitingSignCompletionAmount: 0,
      awaitingSignCompletionOrderCount: 0,
      returnAmount: 0,
      returnCount: 0,
      qualityReturnCount: 0,
      returnRate: 0,
      signRate: 0.1,
    },
  ]
  const badSignSummary = {
    ...summary,
    offlineGmv: 0,
    onlineGmv: 200,
  }
  const badSignRes = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: badSignSummary,
      anchorPerformanceSummary: badSignSummary,
      enrichedAnchorLeaderboard: withFeiyun,
    }),
  )
  assert.equal(badSignRes.status, 'failed')
  assert.ok(
    badSignRes.mismatches.some((m) => m.metric === 'anchor_rate_mismatch:飞云.signRate'),
    JSON.stringify(badSignRes.mismatches),
  )
  console.log('  [unit] wrong anchor signRate => FAIL')

  // orderCount=0 rate=0 FAIL；rate=null PASS
  const zeroRate0 = {
    anchorName: '空卡',
    totalGmv: 0,
    orderCount: 0,
    validSalesAmount: 0,
    actualSignedAmount: 0,
    signedOrderCount: 0,
    awaitingSignCompletionAmount: 0,
    awaitingSignCompletionOrderCount: 0,
    returnAmount: 0,
    returnCount: 0,
    qualityReturnCount: 0,
    returnRate: 0,
    signRate: 0,
  }
  const zeroSummary = emptySummary
  const zeroFail = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: zeroSummary,
      anchorPerformanceSummary: zeroSummary,
      enrichedAnchorLeaderboard: [zeroRate0],
    }),
  )
  assert.equal(zeroFail.status, 'failed')
  assert.ok(zeroFail.mismatches.some((m) => m.metric.includes('anchor_rate_mismatch:空卡')))
  console.log('  [unit] orderCount=0 rate=0 => FAIL')

  const zeroOk = { ...zeroRate0, returnRate: null, signRate: null }
  const zeroPass = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: zeroSummary,
      anchorPerformanceSummary: zeroSummary,
      enrichedAnchorLeaderboard: [zeroOk],
    }),
  )
  assert.equal(zeroPass.status, 'pass', JSON.stringify(zeroPass.mismatches))
  console.log('  [unit] orderCount=0 rate=null => PASS')

  // 重复主播行 FAIL（不自动合并）
  const dup = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: [...rows, { ...rows[0]! }],
    }),
  )
  assert.equal(dup.status, 'failed')
  assert.ok(
    dup.mismatches.some((m) => m.metric.startsWith('duplicate_anchor_row:')),
    JSON.stringify(dup.mismatches),
  )
  console.log('  [unit] duplicate anchor row => FAIL')

  // 负 GMV / NaN / rate>1 FAIL
  const neg = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: zeroSummary,
      anchorPerformanceSummary: zeroSummary,
      enrichedAnchorLeaderboard: [{ ...zeroOk, totalGmv: -1, gmv: -1 }],
    }),
  )
  assert.equal(neg.status, 'failed')
  assert.ok(neg.mismatches.some((m) => m.metric.includes('invalid_anchor_metric:空卡.totalGmv')))

  const nanRow = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: zeroSummary,
      anchorPerformanceSummary: zeroSummary,
      enrichedAnchorLeaderboard: [{ ...zeroOk, orderCount: Number.NaN }],
    }),
  )
  assert.equal(nanRow.status, 'failed')
  assert.ok(nanRow.mismatches.some((m) => m.metric.includes('invalid_anchor_metric:空卡.orderCount')))

  const rateOver = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: rows.map((r) =>
        r.anchorName === '小白' ? { ...r, returnRate: 1.5 } : { ...r },
      ),
    }),
  )
  assert.equal(rateOver.status, 'failed')
  assert.ok(
    rateOver.mismatches.some(
      (m) =>
        m.metric === 'invalid_anchor_metric:小白.returnRate' ||
        m.metric === 'anchor_rate_mismatch:小白.returnRate',
    ),
  )
  console.log('  [unit] negative GMV / NaN / rate>1 => FAIL')
}

function testMissingMetricFieldsFail(): void {
  const summary = baseSummary()
  delete summary.totalGmv
  delete summary.gmv
  const result = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: baseSummary(),
      enrichedAnchorLeaderboard: baseRows(),
    }),
  )
  assert.equal(result.status, 'failed')
  assert.ok(
    result.mismatches.some((m) => m.metric === 'missing_metric_field:overview.totalGmv'),
    JSON.stringify(result.mismatches),
  )
  console.log('  [unit] missing core field => FAIL missing_metric_field')
}

function testWrongReturnRateAndSignRateFail(): void {
  const summary = { ...baseSummary(), returnRate: 0.99 }
  const badReturn = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary,
      anchorPerformanceSummary: summary,
      enrichedAnchorLeaderboard: baseRows(),
    }),
  )
  assert.equal(badReturn.status, 'failed')
  assert.ok(
    badReturn.mismatches.some((m) => m.metric.includes('returnRate')),
    JSON.stringify(badReturn.mismatches),
  )

  const summary2 = { ...baseSummary(), signRate: 0.01 }
  const badSign = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: summary2,
      anchorPerformanceSummary: summary2,
      enrichedAnchorLeaderboard: baseRows(),
    }),
  )
  assert.equal(badSign.status, 'failed')
  assert.ok(
    badSign.mismatches.some((m) => m.metric.includes('signRate')),
    JSON.stringify(badSign.mismatches),
  )

  // 分母 0：rate 必须为 null，禁止用 0 冒充
  const zeroOrders = {
    ...baseSummary(),
    totalGmv: 0,
    onlineGmv: 0,
    offlineGmv: 0,
    orderCount: 0,
    validSalesAmount: 0,
    actualSignedAmount: 0,
    signedOrderCount: 0,
    awaitingSignCompletionAmount: 0,
    awaitingSignCompletionOrderCount: 0,
    returnAmount: 0,
    returnCount: 0,
    qualityReturnCount: 0,
    returnRate: 0,
    signRate: 0,
  }
  const zeroFail = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: zeroOrders,
      anchorPerformanceSummary: zeroOrders,
      enrichedAnchorLeaderboard: [],
    }),
  )
  assert.equal(zeroFail.status, 'failed')
  assert.ok(zeroFail.mismatches.some((m) => m.metric.includes('returnRate')))
  assert.ok(zeroFail.mismatches.some((m) => m.metric.includes('signRate')))

  const zeroOk = {
    ...zeroOrders,
    returnRate: null,
    signRate: null,
  }
  const zeroPass = reconcileBusinessBoardCacheEntry(
    makeEntry({
      summary: zeroOk,
      anchorPerformanceSummary: zeroOk,
      enrichedAnchorLeaderboard: [],
    }),
  )
  assert.equal(zeroPass.status, 'pass', JSON.stringify(zeroPass.mismatches))
  console.log('  [unit] wrong returnRate/signRate + zero-denom null semantics OK')
}

function testStoredKeyAndCompatibilityPending(): void {
  const todayEntry = makeEntry({
    preset: 'today',
    startDate: '2026-08-11',
    endDate: '2026-08-11',
    summary: baseSummary(),
    enrichedAnchorLeaderboard: baseRows(),
    dataGeneration: fullGeneration({ qualityGeneration: 1, liveSessionsGeneration: 1 }),
  })
  const todayResult = reconcileBusinessBoardCacheEntry(todayEntry)
  assert.equal(todayResult.status, 'pass')

  // 跨日：today 旧结果（日期是昨天）不可用于今日 entry
  const staleTodayStored: BoardReconciliationResult = {
    ...todayResult,
    startDate: '2026-08-10',
    endDate: '2026-08-10',
  }
  assert.equal(isStoredReconciliationCompatible(staleTodayStored, todayEntry), false)
  const pendingFromStale = buildApiReconciliationPayload(staleTodayStored, todayEntry)
  assert.equal(pendingFromStale.status, 'pending')
  console.log('  [unit] cross-day today old result => pending')

  // qualityGeneration 变化
  const qualityChanged = makeEntry({
    ...todayEntry,
    summary: baseSummary(),
    enrichedAnchorLeaderboard: baseRows(),
    dataGeneration: fullGeneration({ qualityGeneration: 99 }),
  })
  assert.equal(isStoredReconciliationCompatible(todayResult, qualityChanged), false)
  assert.equal(buildApiReconciliationPayload(todayResult, qualityChanged).status, 'pending')
  console.log('  [unit] qualityGeneration change => pending')

  // liveSessionsGeneration 变化
  const liveChanged = makeEntry({
    ...todayEntry,
    summary: baseSummary(),
    enrichedAnchorLeaderboard: baseRows(),
    dataGeneration: fullGeneration({ liveSessionsGeneration: 77 }),
  })
  assert.equal(isStoredReconciliationCompatible(todayResult, liveChanged), false)
  assert.equal(buildApiReconciliationPayload(todayResult, liveChanged).status, 'pending')
  console.log('  [unit] liveSessionsGeneration change => pending')

  // 存储 key 含日期
  assert.equal(
    buildReconciliationStorageKey('today', '2026-08-11', '2026-08-11'),
    'today|2026-08-11|2026-08-11',
  )
  assert.notEqual(
    buildReconciliationStorageKey('custom', '2026-08-01', '2026-08-05'),
    buildReconciliationStorageKey('custom', '2026-08-01', '2026-08-11'),
  )
  console.log('  [unit] storage key preset|startDate|endDate OK')
}

function testCustomRangesNeverReuse(): void {
  const customA = makeEntry({
    preset: 'custom',
    startDate: '2026-08-01',
    endDate: '2026-08-05',
    summary: baseSummary(),
    enrichedAnchorLeaderboard: baseRows(),
  })
  const customB = makeEntry({
    preset: 'custom',
    startDate: '2026-08-01',
    endDate: '2026-08-11',
    summary: { ...baseSummary(), totalGmv: 999, onlineGmv: 969, offlineGmv: 30 },
    enrichedAnchorLeaderboard: baseRows(),
  })
  const storedA = reconcileBusinessBoardCacheEntry(customA)
  assert.equal(storedA.status, 'pass')

  // 即使传入 customA 的 stored，对 customB 也应只读 reconcile 当前 entry（失败），不得返回 storedA
  const payloadB = buildApiReconciliationPayload(storedA, customB)
  assert.equal(payloadB.status, 'failed')
  assert.equal(payloadB.startDate, '2026-08-01')
  assert.equal(payloadB.endDate, '2026-08-11')
  assert.ok(payloadB.mismatches.some((m) => m.metric.includes('totalGmv')))
  assert.notEqual(payloadB.generation, null)

  const payloadA = buildApiReconciliationPayload(null, customA)
  assert.equal(payloadA.status, 'pass')
  console.log('  [unit] two custom ranges: live reconcile, no cross-reuse')
}

async function testStableAsyncNeverReplaces(): Promise<void> {
  const recalculated = {
    totalGmv: 12345.67,
    validSalesAmount: 11111.11,
    orderCount: 42,
    actualSignedAmount: 9000,
    returnAmount: 200,
    returnCount: 3,
    qualityReturnCount: 1,
    _marker: 'latest-fact',
  }
  const applied = await applyLastMonthStableSummary({
    preset: 'lastMonth',
    startDate: resolveBusinessRange('lastMonth').startDate,
    recalculatedSummary: recalculated,
  })
  assert.equal(applied.summary.totalGmv, 12345.67)
  assert.equal(applied.summary.orderCount, 42)
  assert.equal(applied.summary._marker, 'latest-fact')
  assert.ok(!('_stableSnapshot' in applied.summary))
  if (applied.stableContext) {
    assert.equal(typeof applied.stableContext.stableValue, 'number')
    assert.equal(typeof applied.stableContext.latestValue, 'number')
    assert.equal(typeof applied.stableContext.needsManualReview, 'boolean')
  }
  console.log('  [db] lastMonth stable snapshot never replaces fact summary')
}

async function testLivePresets(): Promise<void> {
  const presets = ['today', 'yesterday', 'thisMonth', 'lastMonth', 'custom'] as const
  for (const preset of presets) {
    const range =
      preset === 'custom'
        ? { startDate: '2026-08-01', endDate: '2026-08-11' }
        : resolveBusinessRange(preset)
    await buildAndSetBusinessBoardCache({
      preset,
      startDate: range.startDate,
      endDate: range.endDate,
    })
    const entry = getBusinessBoardCache(preset, range.startDate, range.endDate)
    assert.ok(entry, `${preset} cache missing`)
    assert.ok(!entry!.summary._stableSnapshot, `${preset} summary must not be snapshot-overridden`)

    const token = generationToken(entry!)
    assert.ok(token)
    assert.equal(token!.split(':').length, 10, `${preset} generation must have 10 parts`)

    const overview = await executeBoardOverviewQuery({
      preset: preset as 'today',
      startDate: range.startDate,
      endDate: range.endDate,
    })
    const anchors = await executeBoardAnchorsQuery({
      preset: preset as 'today',
      startDate: range.startDate,
      endDate: range.endDate,
    })

    const ovGen = overview.cacheStatus?.dataGeneration
    const anGen = anchors.cacheStatus?.dataGeneration
    assert.deepEqual(ovGen, anGen, `${preset} overview/anchors generation mismatch`)

    assert.ok(overview.businessCacheFingerprint || overview.cacheStatus?.businessCacheFingerprint)
    assert.ok(overview.businessMetricsVersion || overview.cacheStatus?.businessMetricsVersion)
    assert.ok(overview.reconciliation, `${preset} overview missing reconciliation`)
    assert.ok(anchors.reconciliation, `${preset} anchors missing reconciliation`)

    if (preset === 'lastMonth') {
      assert.ok(!('_stableSnapshot' in (overview.summary ?? {})))
      assert.equal(
        Number(overview.summary?.totalGmv ?? 0),
        Number(entry!.summary.totalGmv ?? 0),
        'lastMonth page must show latest cache fact GMV',
      )
    }

    const result = reconcileBusinessBoardCacheEntry(entry!)
    const summed = sumAnchorLeaderboardFacts(
      entry!.enrichedAnchorLeaderboard ?? entry!.anchorLeaderboard ?? [],
    )
    const ov = entry!.summary
    const metrics = [
      'totalGmv',
      'orderCount',
      'validSalesAmount',
      'actualSignedAmount',
      'signedOrderCount',
      'awaitingSignCompletionAmount',
      'awaitingSignCompletionOrderCount',
      'returnAmount',
      'returnCount',
      'qualityReturnCount',
    ] as const
    console.log(
      `  [${preset}] recon=${result.status} mismatches=${result.mismatches.length} gen=${result.generation}`,
    )
    for (const key of metrics) {
      const overviewValue = Number(
        ov[key] ??
          (key === 'totalGmv' ? ov.gmv : key === 'validSalesAmount' ? ov.effectiveGmv : 0) ??
          0,
      )
      const anchorValue = Number(summed[key] ?? 0)
      const diff =
        key.includes('Count') || key === 'orderCount' || key === 'signedOrderCount'
          ? overviewValue - anchorValue
          : Math.round((overviewValue - anchorValue) * 100) / 100
      console.log(`    ${key}: overview=${overviewValue} anchor=${anchorValue} diff=${diff}`)
    }
    if (result.status === 'failed') {
      for (const m of result.mismatches.slice(0, 12)) {
        console.log(
          `    - ${m.metric}: overview=${m.overviewValue} anchor=${m.anchorValue} diff=${m.difference}`,
        )
      }
      assert.fail(`${preset} cross-page reconciliation failed`)
    }
  }

  await runBoardCrossPageReconciliationForPresets([
    'today',
    'yesterday',
    'thisMonth',
    'lastMonth',
  ])
}

async function main(): Promise<void> {
  console.log('[check:board-cross-page-consistency]')
  testStableSnapshotNeverOverrides()
  testGenerationTokenIncludesAllTenFields()
  testReconcilePassAndFail()
  testAnchorRowIntegrityGate()
  testMissingMetricFieldsFail()
  testWrongReturnRateAndSignRateFail()
  testStoredKeyAndCompatibilityPending()
  testCustomRangesNeverReuse()
  await testStableAsyncNeverReplaces()
  await testLivePresets()
  console.log('[check:board-cross-page-consistency] PASS')
}

main()
  .catch((err) => {
    console.error('[check:board-cross-page-consistency] FAIL', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
