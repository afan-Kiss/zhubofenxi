/**
 * 买家金额口径验收：静水流深 / 腾棋
 * npx tsx apps/server/scripts/buyer-amount-consistency-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import {
  prepareAnalysisArtifactsFromRaw,
  warmWorkbenchCacheForOrders,
} from '../src/services/business-analysis.service'
import { buildBuyerRankingSummaryFromViews } from '../src/services/buyer-ranking.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import {
  pickBuyerNicknameFromView,
  resolveBuyerIdentityFromView,
  viewMatchesBuyerKey,
} from '../src/services/buyer-identity.service'
import { mapViewToBoardDrillRow } from '../src/services/order-row-mapper.service'
import {
  aggregateWorkbenchRefund,
  mergeWorkbenchIntoMemory,
  syncWorkbenchForOrderNo,
} from '../src/services/xhs-after-sales-workbench.service'
import { getDecryptedCookie } from '../src/services/credential.service'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function viewsForNickname(views: ReturnType<typeof prepareAnalysisArtifactsFromRaw>['views'], nick: string) {
  return views.filter((v) => pickBuyerNicknameFromView(v).includes(nick))
}

function viewsForOrderNos(
  views: ReturnType<typeof prepareAnalysisArtifactsFromRaw>['views'],
  orderNos: string[],
) {
  return views.filter((v) => {
    const no = v.displayOrderNo || v.officialOrderNo || v.packageId || ''
    return orderNos.some((n) => no.includes(n))
  })
}

function sumCent(views: ReturnType<typeof prepareAnalysisArtifactsFromRaw>['views'], pick: (v: (typeof views)[0]) => number) {
  return views.reduce((s, v) => s + pick(v), 0)
}

async function warmOrders(orderNos: string[]): Promise<void> {
  try {
    await getDecryptedCookie()
    for (const no of orderNos) {
      const r = await syncWorkbenchForOrderNo(no)
      mergeWorkbenchIntoMemory(undefined, no, r)
    }
  } catch {
    console.log('Cookie 不可用，使用 mock 售后工作台数据')
    mergeWorkbenchIntoMemory(undefined, 'P794053985617460471', {
      ...aggregateWorkbenchRefund(
        [
          {
            delivery_package_id: 'P794053985617460471',
            refund_fee: 499,
            refund_status_name: '退款成功',
          },
        ],
        'P794053985617460471',
      ),
      fetchStatus: 'success',
      fetchError: null,
      fetchedAt: new Date(),
    })
    mergeWorkbenchIntoMemory(undefined, 'P794053251604460971', {
      ...aggregateWorkbenchRefund(
        [
          {
            delivery_package_id: 'P794053251604460971',
            refund_fee: 2980,
            refund_status_name: '退款成功',
          },
        ],
        'P794053251604460971',
      ),
      fetchStatus: 'success',
      fetchError: null,
      fetchedAt: new Date(),
    })
    mergeWorkbenchIntoMemory(undefined, 'P794833941198079611', {
      ...aggregateWorkbenchRefund(
        [
          {
            delivery_package_id: 'P794833941198079611',
            refund_fee: 1999,
            refund_status_name: '退款成功',
          },
        ],
        'P794833941198079611',
      ),
      fetchStatus: 'success',
      fetchError: null,
      fetchedAt: new Date(),
    })
    mergeWorkbenchIntoMemory(undefined, 'P794831040850079251', {
      ...aggregateWorkbenchRefund(
        [
          {
            delivery_package_id: 'P794831040850079251',
            refund_fee: 1999,
            refund_status_name: '退款成功',
          },
        ],
        'P794831040850079251',
      ),
      fetchStatus: 'success',
      fetchError: null,
      fetchedAt: new Date(),
    })
  }
}

async function main() {
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.log('跳过：无本地订单')
    return
  }

  const warmNos = [
    'P794053985617460471',
    'P794053969154460631',
    'P794053251604460971',
    'P794833941198079611',
    'P794831040850079251',
  ]
  await warmOrders(warmNos)
  const toWarm = bundle.orders.filter((o) => {
    const no = (o.displayOrderNo || o.officialOrderNo || '').trim()
    return warmNos.includes(no)
  })
  await warmWorkbenchCacheForOrders(toWarm, { maxImmediateSync: 5 })

  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const views = artifacts.views

  // —— 静水流深 ——
  const jsOrderNos = [
    'P794053985617460471',
    'P794053969154460631',
    'P794053251604460971',
  ]
  let jsViews = viewsForNickname(views, '静水流深')
  if (jsViews.length < 3) {
    jsViews = viewsForOrderNos(views, jsOrderNos)
  }
  assert(jsViews.length >= 3, `静水流深订单数应≥3，实际 ${jsViews.length}`)

  const jsKeys = new Set(jsViews.map((v) => resolveBuyerIdentityFromView(v)?.buyerKey).filter(Boolean))
  const jsKey = [...jsKeys][0]
  assert(jsKeys.size === 1, `静水流深应归为一个 buyerKey，实际 ${jsKeys.size} 个`)

  const jsReceivable = sumCent(jsViews, (v) => v.receivableAmountCent || 0)
  const jsPaid = sumCent(jsViews, (v) => v.statPaidAmountCent ?? (v.includedInGmv ? v.paymentBaseCent : 0))
  const jsRefund = sumCent(jsViews, (v) => v.buyerProductRefundAmountCent ?? 0)

  assert(jsReceivable === 393_200, `静水流深应收合计 ${jsReceivable} 应为 393200`)
  assert(jsPaid === 351_500, `静水流深支付合计 ${jsPaid} 应为 351500`)
  assert(jsRefund === 347_900, `静水流深退款合计 ${jsRefund} 应为 347900`)

  const o1 = jsViews.find((v) => (v.displayOrderNo || '').includes('P794053985617460471'))
  const o2 = jsViews.find((v) => (v.displayOrderNo || '').includes('P794053969154460631'))
  const o3 = jsViews.find((v) => (v.displayOrderNo || '').includes('P794053251604460971'))
  assert((o1?.buyerProductRefundAmountCent ?? 0) === 49_900, 'P794053985617460471 退款应为 49900')
  assert((o2?.buyerProductRefundAmountCent ?? 0) === 0, 'P794053969154460631 退款应为 0')
  assert((o3?.buyerProductRefundAmountCent ?? 0) === 298_000, 'P794053251604460971 退款应为 298000')

  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of bundle.orders) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const rankingViews = attachRawByMatchToViews(views, rawByMatch)

  const { items } = buildBuyerRankingSummaryFromViews(rankingViews)
  const jsBuyer = items.find((i) => i.buyerKey === jsKey)
  assert(jsBuyer != null, '买家排行应包含静水流深')
  assert(Math.round((jsBuyer.receivableAmount ?? 0) * 100) === 393_200, '排行应收与明细一致')
  assert(
    jsBuyer.buyerSummary?.payAmountCent === jsPaid,
    `排行支付与明细一致，实际 ${jsBuyer.buyerSummary?.payAmountCent} vs ${jsPaid}`,
  )
  assert(
    jsBuyer.buyerSummary?.refundAmountCent === jsRefund,
    `排行退款与明细一致，实际 ${jsBuyer.buyerSummary?.refundAmountCent} vs ${jsRefund}`,
  )

  if (jsKey) {
    const drillViews = views.filter((v) => viewMatchesBuyerKey(v, jsKey))
    const drillRefund = sumCent(drillViews, (v) => v.buyerProductRefundAmountCent ?? 0)
    assert(drillRefund === jsRefund, 'Drawer buyerKey 过滤退款应与汇总一致')
  }

  console.log('静水流深验收通过')

  // —— 腾棋（固定 P 单号，避免同名买家污染）——
  const tqOrderNos = ['P794833941198079611', 'P794831040850079251']
  const tqViews = viewsForOrderNos(views, tqOrderNos)
  assert(tqViews.length >= 2, `腾棋订单数应≥2，实际 ${tqViews.length}`)

  const tqRefund = sumCent(tqViews, (v) => v.buyerProductRefundAmountCent ?? 0)
  assert(
    tqRefund === 399_800,
    `腾棋退款合计 ${tqRefund} 应为 399800（两笔 refund_fee 1999），禁止用 2017 应收兜底`,
  )

  for (const v of tqViews) {
    const row = mapViewToBoardDrillRow(
      Object.assign({}, v, { raw: artifacts.dedupe.uniqueOrders.find((o) => o.matchOrderId === v.matchOrderId)?.raw }),
      { useBuyerRefund: true },
    )
    const no = row.orderNo
    if (no.includes('P794833941198079611') || no.includes('P794831040850079251')) {
      assert(
        Math.round(row.refundAmount * 100) === 199_900,
        `${no} 退款行应为 1999，实际 ${row.refundAmount}`,
      )
      assert(
        row.refundAmountSource === 'after_sales_workbench' ||
          row.refundAmountSource === 'after_sales_workbench_expected' ||
          row.refundAmountSource === 'after_sales_workbench_applied',
        `${no} 退款来源应为售后工作台`,
      )
    }
  }

  console.log('腾棋验收通过')
  console.log('\n全部买家金额验收通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
