/**
 * 官方品退 HAR 样例硬验收（开发用）
 * npx tsx apps/server/scripts/quality-badcase-har-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import { loadAllQualityBadCases } from '../src/services/quality-badcase-store.service'
import {
  explainHarSampleInclusion,
  verifyQualityBadCases,
} from '../src/services/quality-badcase-verify.service'
import { matchStatusLabel } from '../src/services/quality-badcase.types'
import { isQualityBadCaseOrderMatched } from '../src/services/quality-badcase.types'

config({ path: path.resolve(__dirname, '../.env') })

const HAR_PACKAGES = ['P795229266485040251', 'P794284642850380311']

function printCase(label: string, c: Awaited<ReturnType<typeof loadAllQualityBadCases>>[0] | null, views: ReturnType<typeof prepareAnalysisArtifactsFromRaw>['views']) {
  if (!c) {
    console.log(`\n=== ${label}：未找到记录 ===`)
    return
  }
  const inclusion = explainHarSampleInclusion(c, views)
  console.log(`\n=== ${label} ===`)
  console.log('packageId:', c.packageId)
  console.log('sourceBizId:', c.sourceBizId)
  console.log('itemName:', c.itemName)
  console.log('feedbackContent:', c.feedbackContent)
  console.log('feedbackTime:', c.feedbackTime)
  console.log('packagePayTime:', c.packagePayTime)
  console.log('matchedOrderNo:', c.matchedOrderNo)
  console.log('matchedAfterSaleId:', c.matchedAfterSaleId)
  console.log('matchedBuyerId:', c.matchedBuyerId)
  console.log('matchedBuyerNickname:', c.matchedBuyerNickname)
  console.log('matchedAnchorId:', c.matchedAnchorId)
  console.log('matchedAnchorName:', c.matchedAnchorName)
  console.log('matchStatus:', matchStatusLabel(c.matchStatus))
  console.log('进入经营总览品退分子:', inclusion.inBoardNumerator)
  console.log('进入主播品退分子:', inclusion.inAnchorNumerator)
  console.log('进入买家品退排行:', inclusion.inBuyerRanking)
  console.log('说明:', inclusion.detail)
}

async function main(): Promise<void> {
  const cases = await loadAllQualityBadCases(true)
  console.log('QualityBadCase 表记录数:', cases.length)
  console.log(
    '未匹配数:',
    cases.filter((c) => c.matchStatus === 'unmatched').length,
  )
  console.log(
    '已匹配订单数:',
    cases.filter(isQualityBadCaseOrderMatched).length,
  )

  const bundle = await buildRawAnalyzeBundleAll()
  const views = bundle ? prepareAnalysisArtifactsFromRaw(bundle).views : []
  const metrics = calculateBusinessMetrics(views)
  const sets = buildOrderMetricSets(views, { scope: 'har-acceptance' }, cases)

  console.log('\n--- 全量视图品退统计 ---')
  console.log('品退分子(去重P单):', sets.qualityRefundOrderCount)
  console.log('支付分母:', sets.paidOrderCount)
  console.log('品退率:', metrics.qualityRefundRate)
  console.log('calculateBusinessMetrics.qualityRefundOrderCount:', metrics.qualityRefundOrderCount)

  const verify = await verifyQualityBadCases()
  console.log('\n--- verify API 摘要 ---')
  console.log(JSON.stringify(verify, null, 2))

  for (const pkg of HAR_PACKAGES) {
    const c = cases.find((x) => x.packageId === pkg || x.matchedOrderNo === pkg) ?? null
    printCase(pkg, c, views)
  }

  const unmatchedInNumerator = cases.filter(
    (c) =>
      c.matchStatus === 'unmatched' &&
      sets.qualityRefundOrderNos.includes(c.packageId),
  )
  if (unmatchedInNumerator.length > 0) {
    console.error('\n[FAIL] 未匹配记录进入了品退分子:', unmatchedInNumerator.map((c) => c.packageId))
    process.exit(1)
  }
  console.log('\n[PASS] 未匹配官方品退未进入核心品退分子')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
