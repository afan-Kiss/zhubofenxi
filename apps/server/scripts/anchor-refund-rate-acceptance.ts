/**
 * 主播退款率口径验收
 * npx tsx apps/server/scripts/anchor-refund-rate-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { calcRefundRate } from '../src/services/calc-refund-rate.service'
import { buildRawAnalyzeBundle } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { resolveDateRange } from '../src/utils/date-range'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main(): Promise<void> {
  const range = resolveDateRange('thisMonth')
  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) throw new Error('无订单数据')
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const views = artifacts.views

  const m = calculateBusinessMetrics(views)
  assert(m.refundOrderCount <= m.orderCount, `全站退款订单数 ${m.refundOrderCount} > 支付 ${m.orderCount}`)
  if (m.refundRate != null) {
    assert(m.refundRate <= 1.000001, `全站退款率异常 ${m.refundRate}`)
  }

  const sample = calcRefundRate({
    paidOrderNos: ['P1', 'P2', 'P3'],
    refundOrderNos: ['P1', 'P2', 'P2', 'P4'],
  })
  assert(sample.paidOrderCount === 3, '样例分母')
  assert(sample.refundOrderCount === 2, '样例分子去重且仅保留已支付')
  assert(sample.refundRate === 2 / 3, '样例比率')

  const leaderboard = aggregateAnchorLeaderboard(views)
  for (const a of leaderboard) {
    assert(
      a.refundOrderCount <= a.orderCount,
      `主播 ${a.anchorName} 退款订单 ${a.refundOrderCount} > 支付 ${a.orderCount}`,
    )
    if (a.refundRate != null) {
      assert(a.refundRate <= 1.000001, `主播 ${a.anchorName} 退款率 ${a.refundRate}`)
    }
  }

  console.log(
    `全站: 支付订单 ${m.orderCount} 退款订单 ${m.refundOrderCount} 售后记录 ${m.afterSaleRecordCount} 退款率 ${m.refundRate == null ? '--' : (m.refundRate * 100).toFixed(2) + '%'}`,
  )
  console.log('✓ anchor-refund-rate-acceptance 通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
