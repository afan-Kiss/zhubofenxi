/**
 * 买家 Drawer 官方支付金额验收：很困 / 小小木
 * npx tsx apps/server/scripts/buyer-drawer-paid-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { buildBuyerRankingSummaryFromViews } from '../src/services/buyer-ranking.service'
import { viewMatchesBuyerKey } from '../src/services/buyer-identity.service'
import { mapViewToBoardDrillRow } from '../src/services/order-row-mapper.service'
import { centToYuan } from '../src/utils/money'
import type { AnalyzedOrderView } from '../types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function viewsByNick(views: AnalyzedOrderView[], nick: string): AnalyzedOrderView[] {
  return views.filter((v) => (v.buyerNickname || '').includes(nick))
}

async function checkBuyer(
  allViews: AnalyzedOrderView[],
  nick: string,
  expected: {
    receivable: number
    paid: number
    refund: number
    orderCount: number
    paidOrderCount: number
    refundCount: number
    qualityReturnCount: number
  },
): Promise<void> {
  const seed = viewsByNick(allViews, nick)
  const buyerKey = seed[0]?.buyerKey
  assert(Boolean(buyerKey), `未找到买家 ${nick}`)
  const buyerViews = allViews.filter((v) => viewMatchesBuyerKey(v, buyerKey!))
  const { items } = buildBuyerRankingSummaryFromViews(buyerViews)
  const stats = items[0]
  assert(Boolean(stats), `无统计 ${nick}`)

  console.log(`\n=== ${nick} (${buyerKey}) ===`)
  console.log(
    `应收 ${stats!.receivableAmount} 支付 ${stats!.gmv} 退款 ${stats!.productRefundAmount} 单数 ${stats!.orderCount} 支付单 ${stats!.paidOrderCount} 退款次 ${stats!.refundCount} 品退 ${stats!.qualityReturnCount}`,
  )

  for (const v of buyerViews) {
    const row = mapViewToBoardDrillRow(v, { useBuyerRefund: true })
    console.log(
      `  ${row.displayOrderNo} recv=${row.receivableAmount} paid=${row.officialPaidAmount ?? '—'} refund=${row.refundAmount} 品退=${row.isQualityReturn}`,
    )
  }

  assert(Math.abs(stats!.receivableAmount - expected.receivable) < 0.02, `${nick} 应收`)
  assert(Math.abs(stats!.gmv - expected.paid) < 0.02, `${nick} 支付`)
  assert(Math.abs(stats!.productRefundAmount - expected.refund) < 0.02, `${nick} 退款`)
  assert(stats!.orderCount === expected.orderCount, `${nick} 下单次数`)
  assert(stats!.paidOrderCount === expected.paidOrderCount, `${nick} 支付订单数`)
  assert(stats!.refundCount === expected.refundCount, `${nick} 退款次数`)
  assert(stats!.qualityReturnCount === expected.qualityReturnCount, `${nick} 品退次数`)
}

async function main(): Promise<void> {
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) throw new Error('无原始订单数据')
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const allViews = artifacts.views

  await checkBuyer(allViews, '很困', {
    receivable: 3051,
    paid: 2991,
    refund: 2973,
    orderCount: 3,
    paidOrderCount: 3,
    refundCount: 3,
    qualityReturnCount: 1,
  })

  const xiaomu = viewsByNick(allViews, '小小木')
  if (xiaomu.length > 0) {
    await checkBuyer(allViews, '小小木', {
      receivable: 417,
      paid: 417,
      refund: 417,
      orderCount: 1,
      paidOrderCount: 1,
      refundCount: 1,
      qualityReturnCount: 1,
    })
  } else {
    console.log('\n跳过小小木（本地无该买家数据）')
  }

  console.log('\n✓ buyer-drawer-paid-acceptance 通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
