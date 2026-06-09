/**
 * 品退验收：官方品退主口径 + 售后时间查询交叉印证
 */
import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { resolveDateRange, type DateRangePreset } from '../../src/utils/date-range'
import { buildRawAnalyzeBundle } from '../../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../../src/services/business-analysis.service'
import {
  aggregateAnchorLeaderboard,
  aggregateViewsMetrics,
  loadBoardArtifactsForRange,
} from '../../src/services/board-metrics.service'
import { buildBuyerRankingSummaryFromViews } from '../../src/services/buyer-ranking.service'
import { filterBuyerRankingByTab } from '../../src/services/buyer-ranking-tab-filters'
import { resolveMetricOrderNo } from '../../src/services/calc-refund-rate.service'
import {
  syncOfficialQualityBadCases,
  rematchStoredQualityBadCases,
} from '../../src/services/official-quality-refund-sync.service'
import {
  HAR_SAMPLE_PACKAGE_IDS,
  seedHarQualityBadCaseFixturesIfNeeded,
} from '../../src/services/quality-badcase-har-fixture.service'
import {
  getQualityBadCaseCoverage,
  loadAllQualityBadCases,
  bootstrapQualityBadCaseCache,
} from '../../src/services/quality-badcase-store.service'
import { isQualityBadCaseOrderMatched } from '../../src/services/quality-badcase.types'
import { buildQualityCrossVerifySummary } from '../../src/services/quality-refund-cross-verify.service'
import { viewCountsAsQualityRefund } from '../../src/services/quality-refund-resolution.service'
import {
  loadAfterSalesTimeSearchByOrderNo,
  mergeAfterSaleRecordMaps,
  syncAfterSalesTimeSearchForRange,
} from '../../src/services/xhs-after-sales-time-search.service'
import { getMatchedOfficialQualityCasesByPackage } from '../../src/services/quality-badcase-store.service'

config({ path: path.resolve(__dirname, '../../.env') })

const prisma = new PrismaClient()

function preset(): DateRangePreset {
  const p = process.env.QUALITY_ACCEPT_PRESET?.trim() as DateRangePreset | undefined
  return p && p !== 'custom' ? p : 'thisMonth'
}

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

async function main(): Promise<void> {
  const range = resolveDateRange(preset())
  console.log(`\n=== 品退验收（官方主口径）${range.startDate} ~ ${range.endDate} ===\n`)

  let officialDataSource = '历史缓存'
  let syncFailed = false
  const existingCount = await prisma.qualityBadCase.count()

  if (existingCount === 0 || envFlag('QUALITY_ACCEPT_FORCE_SYNC')) {
    try {
      const sync = await syncOfficialQualityBadCases()
      if (sync.ok) {
        officialDataSource = '实时 API 同步'
        console.log(`官方品退 API 同步成功: cases=${sync.data.caseCount}`)
      } else {
        syncFailed = true
        officialDataSource = '同步失败，使用历史缓存/种子'
        console.warn(`⚠ 官方品退接口同步失败: ${sync.error ?? '无数据'}`)
        console.warn('主品退指标无法按最新官方口径更新；将尝试历史缓存或 HAR 种子')
      }
    } catch (e) {
      syncFailed = true
      officialDataSource = '同步异常，使用历史缓存/种子'
      console.warn(`⚠ 官方品退接口同步异常: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    const cov = await getQualityBadCaseCoverage()
    officialDataSource = cov.lastSyncedAt ? `历史缓存（${cov.lastSyncedAt}）` : '历史缓存'
    console.log(`官方品退数据来源: ${officialDataSource}`)
  }

  if ((await prisma.qualityBadCase.count()) === 0 || envFlag('QUALITY_ACCEPT_SEED_HAR')) {
    const seeded = await seedHarQualityBadCaseFixturesIfNeeded({
      force: envFlag('QUALITY_ACCEPT_SEED_HAR'),
    })
    console.log(`HAR 种子: seeded=${seeded.seeded} matched=${seeded.matchedOrderCount}`)
    if (seeded.seeded > 0) officialDataSource = 'HAR 验收种子（非实时 API）'
  }

  await rematchStoredQualityBadCases()
  await bootstrapQualityBadCaseCache()
  const officialCases = await loadAllQualityBadCases(true)

  let afterSaleSyncNote = '使用缓存'
  try {
    const as = await syncAfterSalesTimeSearchForRange(range, {
      force: envFlag('QUALITY_ACCEPT_FORCE_AFTER_SALE'),
    })
    afterSaleSyncNote = as.fromCache
      ? `缓存 ${as.recordCount} 条`
      : `API ${as.recordCount} 条`
    if (as.warnings.length) console.log('售后时间查询警告:', as.warnings.slice(0, 3).join('; '))
  } catch (e) {
    afterSaleSyncNote = `失败: ${e instanceof Error ? e.message : String(e)}`
    console.warn('售后时间查询:', afterSaleSyncNote)
  }

  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) {
    console.error('无订单数据')
    process.exit(1)
  }

  const timeSearchMap = await loadAfterSalesTimeSearchByOrderNo(
    range,
    bundle.orders.map((o) => (o.displayOrderNo || o.packageId || '').trim()).filter(Boolean),
  )
  const mergedAfterSale = mergeAfterSaleRecordMaps(
    bundle.rawAfterSalesByOrderNo ?? new Map(),
    timeSearchMap,
  )

  const artifacts = prepareAnalysisArtifactsFromRaw({
    ...bundle,
    rawAfterSalesByOrderNo: mergedAfterSale,
  })
  const views = artifacts.views
  const officialByPackage = getMatchedOfficialQualityCasesByPackage(officialCases)
  const officialPackageIds = new Set(officialByPackage.keys())

  const getAfterSaleRecords = (orderNo: string) => mergedAfterSale.get(orderNo) ?? []

  const summary = buildQualityCrossVerifySummary({
    views,
    officialCases,
    afterSaleTimeSearchCount: await prisma.xhsAfterSalesTimeSearchCache.count({
      where: { rangeKey: `${range.startDate}_${range.endDate}` },
    }),
    getAfterSaleRecords,
  })

  console.log('\n=== A. 官方品退主指标 ===')
  console.log(`数据来源: ${officialDataSource}${syncFailed ? '（⚠ 实时同步失败）' : ''}`)
  console.log(`officialBadCasePackageCount: ${summary.officialBadCasePackageCount}`)
  console.log(`officialMatchedOrderCount: ${summary.officialMatchedOrderCount}`)
  console.log(`officialQualityRefundOrderCount: ${summary.officialQualityRefundOrderCount}`)
  console.log(`officialQualityRefundOrderNos: ${summary.officialQualityRefundOrderNos.join(', ') || '（无）'}`)

  console.log('\n=== B. 售后时间查询交叉印证 ===')
  console.log(`售后时间查询: ${afterSaleSyncNote}`)
  console.log(`afterSaleTimeSearchCount: ${summary.afterSaleTimeSearchCount}`)
  console.log(`afterSaleMatchedOfficialCount: ${summary.afterSaleMatchedOfficialCount}`)
  console.log(`verifiedCount: ${summary.verifiedCount}`)
  console.log(`officialOnlyCount: ${summary.officialOnlyCount}`)
  console.log(`afterSaleOnlyCount: ${summary.afterSaleOnlyCount}`)
  console.log(`conflictCount: ${summary.conflictCount}`)
  console.log(`unmatchedCount: ${summary.unmatchedCount}`)

  if (summary.conflictSamples.length) {
    console.log('\n--- conflict 样例 ---')
    for (const c of summary.conflictSamples) {
      console.log(JSON.stringify(c))
    }
  }
  if (summary.afterSaleOnlySamples.length) {
    console.log('\n--- after_sale_only 样例（不计入主指标）---')
    for (const c of summary.afterSaleOnlySamples.slice(0, 10)) {
      console.log(JSON.stringify(c))
    }
  }

  const boardArtifacts = await loadBoardArtifactsForRange(
    preset(),
    range.startDate,
    range.endDate,
  )
  const overviewMetrics = aggregateViewsMetrics(boardArtifacts.views)
  const anchorQualityTotal = aggregateAnchorLeaderboard(boardArtifacts.views).reduce(
    (s, a) => s + (a.qualityReturnCount ?? 0),
    0,
  )
  const buyerRanking = buildBuyerRankingSummaryFromViews(boardArtifacts.views)
  const qualityBuyers = filterBuyerRankingByTab(buyerRanking.items, 'quality')

  console.log('\n=== C. 页面 API 结果 ===')
  console.log(`经营总览品退单数: ${overviewMetrics.qualityReturnCount}`)
  console.log(
    `品退率: ${overviewMetrics.qualityReturnRate != null ? (overviewMetrics.qualityReturnRate * 100).toFixed(2) + '%' : '—'}`,
  )
  console.log(`主播业绩品退合计: ${anchorQualityTotal}`)
  console.log(`买家排行品退客户数: ${buyerRanking.summary.qualityHeavyCount}`)
  console.log(`品退榜条数: ${qualityBuyers.length}`)

  console.log('\n=== D. 一致性检查 ===')
  const mismatches: string[] = []
  const officialCount = summary.officialQualityRefundOrderCount

  if (overviewMetrics.qualityReturnCount !== officialCount) {
    mismatches.push(
      `经营总览(${overviewMetrics.qualityReturnCount}) != 官方主指标(${officialCount})`,
    )
  }
  if (anchorQualityTotal !== officialCount) {
    mismatches.push(`主播合计(${anchorQualityTotal}) != 官方主指标(${officialCount})`)
  }

  const buyerQualityOrders = new Set<string>()
  for (const item of qualityBuyers) {
    for (const v of boardArtifacts.views) {
      if (
        (v.buyerKey === item.buyerKey || v.buyerId === item.buyerId) &&
        viewCountsAsQualityRefund(v, officialPackageIds)
      ) {
        const no = resolveMetricOrderNo(v)
        if (no) buyerQualityOrders.add(no)
      }
    }
  }
  if (buyerQualityOrders.size !== officialCount && officialCount > 0) {
    mismatches.push(
      `买家品退去重(${buyerQualityOrders.size}) != 官方主指标(${officialCount})`,
    )
  }

  const afterSaleOnlyInMain = views.filter(
    (v) => v.suspectedQualityRefund && v.isQualityReturn,
  )
  if (afterSaleOnlyInMain.length > 0) {
    mismatches.push(`after_sale_only 进入了主品退指标: ${afterSaleOnlyInMain.length} 笔`)
  }

  for (const pkg of HAR_SAMPLE_PACKAGE_IDS) {
    const inMain = summary.officialQualityRefundOrderNos.includes(pkg)
    const hasOfficial = officialCases.some((c) => c.packageId === pkg)
    const matched = officialCases.some(
      (c) => c.packageId === pkg && isQualityBadCaseOrderMatched(c),
    )
    console.log(`HAR ${pkg}: 官方记录=${hasOfficial} 匹配订单=${matched} 主指标=${inMain}`)
    if (matched && !inMain) {
      mismatches.push(`HAR ${pkg} 已匹配但未进入主指标`)
    }
  }

  if (mismatches.length) {
    console.log('\n*** MISMATCH ***')
    for (const m of mismatches) console.log(`- ${m}`)
    process.exit(1)
  }

  console.log('\n✓ 品退验收通过（官方主口径）')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
