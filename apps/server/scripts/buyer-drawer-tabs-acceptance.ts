/**
 * 买家 Drawer Tab 筛选验收
 * npx tsx apps/server/scripts/buyer-drawer-tabs-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { buildBuyerProfileOrdersResponse } from '../src/services/buyer-profile-orders.service'
import { centToYuan } from '../src/utils/money'
import type { AnalyzedOrderView } from '../types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function viewsByNick(views: AnalyzedOrderView[], nick: string): AnalyzedOrderView[] {
  return views.filter((v) => (v.buyerNickname || '').includes(nick))
}

async function checkBuyerTabs(
  allViews: AnalyzedOrderView[],
  rawByMatch: Map<string, Record<string, unknown>>,
  nick: string,
  expected: {
    qualityCount: number
    afterSaleCount: number
    normalSignedCount: number
  },
): Promise<void> {
  const seed = viewsByNick(allViews, nick)
  const buyerKey = seed[0]?.buyerKey
  assert(Boolean(buyerKey), `未找到买家 ${nick}`)

  const payload = buildBuyerProfileOrdersResponse({
    buyerKey: buyerKey!,
    allViews,
    rawByMatch,
    page: 1,
    pageSize: 50,
    tab: 'all',
  })

  console.log(`\n=== ${nick} 全量 summary ===`)
  console.log(
    `下单 ${payload.buyerSummary.orderCount} 支付 ${payload.buyerSummary.paidOrderCount} ` +
      `退款单 ${payload.buyerSummary.refundOrderCount} 品退 ${payload.buyerSummary.qualityRefundOrderCount}`,
  )

  const tabMap = Object.fromEntries(payload.tabs.map((t) => [t.key, t.count]))
  assert(tabMap.quality_refund === expected.qualityCount, `${nick} 品退 Tab 数量`)
  assert(tabMap.after_sale === expected.afterSaleCount, `${nick} 售后 Tab 数量`)
  assert(tabMap.normal_signed === expected.normalSignedCount, `${nick} 正常签收 Tab 数量`)

  const qualityRows = buildBuyerProfileOrdersResponse({
    buyerKey: buyerKey!,
    allViews,
    rawByMatch,
    tab: 'quality_refund',
  })
  assert(
    qualityRows.rows.every((r) => r.isQualityRefund),
    `${nick} 品退 Tab 含非品退订单`,
  )
  assert(qualityRows.rows.length === expected.qualityCount, `${nick} 品退 Tab 行数`)

  const signedRows = buildBuyerProfileOrdersResponse({
    buyerKey: buyerKey!,
    allViews,
    rawByMatch,
    tab: 'normal_signed',
  })
  for (const r of signedRows.rows) {
    assert(!r.hasRefund && r.refundAmountCent === 0, `${nick} 正常签收含退款单 ${r.orderNo}`)
  }

  assert(
    payload.stats.qualityReturnCount === payload.buyerSummary.qualityRefundOrderCount,
    `${nick} 外层 stats 与 summary 品退数不一致`,
  )
  console.log(`  累计下单 ¥${centToYuan(payload.buyerSummary.receivableAmountCent)}`)
  console.log(`  累计实付 ¥${centToYuan(payload.buyerSummary.payAmountCent)}`)
  console.log(`  累计退款 ¥${centToYuan(payload.buyerSummary.refundAmountCent)}`)
}

async function main(): Promise<void> {
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) throw new Error('无原始订单数据')
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const allViews = artifacts.views
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts.dedupe.uniqueOrders) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }

  await checkBuyerTabs(allViews, rawByMatch, '很困', {
    qualityCount: 1,
    afterSaleCount: 3,
    normalSignedCount: 0,
  })

  for (const nick of ['小小木', '行走的皮囊']) {
    const seed = viewsByNick(allViews, nick)
    if (seed.length === 0) {
      console.log(`\n跳过 ${nick}（本地无数据）`)
      continue
    }
    const payload = buildBuyerProfileOrdersResponse({
      buyerKey: seed[0]!.buyerKey!,
      allViews,
      rawByMatch,
    })
    const qc = payload.buyerSummary.qualityRefundOrderCount
    if (qc > 0) {
      const qualityRows = buildBuyerProfileOrdersResponse({
        buyerKey: seed[0]!.buyerKey!,
        allViews,
        rawByMatch,
        tab: 'quality_refund',
      })
      assert(qualityRows.rows.length === qc, `${nick} 品退 Tab 应为 ${qc}`)
      console.log(`\n✓ ${nick} 品退 ${qc} Tab 对齐`)
    }
  }

  console.log('\n✓ buyer-drawer-tabs-acceptance 通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
