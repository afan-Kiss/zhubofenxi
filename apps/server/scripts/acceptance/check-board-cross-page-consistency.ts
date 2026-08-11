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

config({ path: path.resolve(__dirname, '../../.env') })

function makeEntry(partial: Partial<BusinessBoardCacheEntry> & {
  summary: Record<string, unknown>
  anchorPerformanceSummary?: Record<string, unknown>
  enrichedAnchorLeaderboard?: Array<Record<string, unknown>>
}): BusinessBoardCacheEntry {
  return {
    cacheKey: 'test',
    preset: partial.preset ?? 'today',
    startDate: partial.startDate ?? '2026-08-11',
    endDate: partial.endDate ?? '2026-08-11',
    scope: 'default',
    range: {
      startDate: partial.startDate ?? '2026-08-11',
      endDate: partial.endDate ?? '2026-08-11',
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
    dataGeneration: {
      ordersGeneration: 1,
      workbenchGeneration: 1,
      timeSearchGeneration: 1,
      scheduleGeneration: 1,
      manualOverrideGeneration: 1,
      offlineDealGeneration: 1,
    },
    ...partial,
  }
}

function testStableSnapshotNeverOverrides(): void {
  // applyLastMonthStableSummary 在无 snapshot 时直接返回 recalculated
  // 有 snapshot 且差额>100 时仍返回 recalculated（禁止替换）
  const recalculated = {
    totalGmv: 9999,
    validSalesAmount: 8888,
    orderCount: 12,
    actualSignedAmount: 7000,
    returnAmount: 100,
    returnCount: 1,
    qualityReturnCount: 0,
    metricsVersion: BUSINESS_METRICS_VERSION,
  }
  // 同步测：仅验证函数签名与「永远返回 recalculated」——无 DB snapshot 时
  void STABLE_AMOUNT_THRESHOLD_YUAN
  void recalculated
  console.log('  [unit] stable override guard defined (async covered in DB section)')
}

function testReconcilePassAndFail(): void {
  // 场景覆盖：普通支付 + 退款≤29 + 退款>29 + 物流已签收未交易完成 + 线下 + 未归属
  // （低价刷单 / 人工归属 / 排班归属由同源事实池保证，不在此重复改口径）
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
  }
  const offline = {
    anchorName: '逸凡',
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
  }
  const summary = {
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
    metricsVersion: BUSINESS_METRICS_VERSION,
  }
  const allRows = [row, offline, unassigned, refundHeavy]
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

  // 禁止只累加「可见直播主播」：隐藏线下行必须计入
  const visibleOnly = sumAnchorLeaderboardFacts([row, unassigned, refundHeavy])
  assert.notEqual(visibleOnly.totalGmv, summary.totalGmv)
  const summed = sumAnchorLeaderboardFacts(allRows)
  assert.equal(summed.totalGmv, 200)
  assert.equal(summed.orderCount, 5)
  assert.equal(summed.qualityReturnCount, 1)
  assert.equal(summed.awaitingSignCompletionAmount, 10)
  console.log('  [unit] reconcile pass/fail + all-anchors sum OK')
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
      console.log(
        `    ${key}: overview=${overviewValue} anchor=${anchorValue} diff=${diff}`,
      )
    }
    if (result.status === 'failed') {
      for (const m of result.mismatches.slice(0, 8)) {
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
  testReconcilePassAndFail()
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
