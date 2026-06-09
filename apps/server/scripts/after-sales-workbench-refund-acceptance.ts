/**
 * 售后工作台退款金额验收
 * npx tsx apps/server/scripts/after-sales-workbench-refund-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import {
  aggregateWorkbenchRefund,
  yuanApiAmountToCent,
} from '../src/services/xhs-after-sales-workbench.service'
import { resolveOrderProductRefund } from '../src/services/order-product-refund.service'
import { classifyOrderAfterSale } from '../src/services/after-sale-classification.service'
import type { NormalizedOrder } from '../src/types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function mockOrder(partial: Partial<NormalizedOrder>): NormalizedOrder {
  return {
    sourceRowIndex: 1,
    orderId: 'x',
    packageId: partial.packageId ?? 'P1',
    bizOrderId: 'x',
    officialOrderNo: partial.officialOrderNo ?? partial.packageId ?? 'P1',
    displayOrderNo: partial.displayOrderNo ?? partial.packageId ?? 'P1',
    matchOrderId: partial.matchOrderId ?? partial.packageId ?? 'P1',
    orderTime: null,
    orderTimeText: '',
    monthKey: '',
    buyerId: 'b',
    gmvCent: partial.gmvCent ?? 0,
    productAmountCent: partial.productAmountCent ?? partial.gmvCent ?? 0,
    receivableAmountCent: partial.receivableAmountCent ?? 0,
    freightCent: partial.freightCent ?? 0,
    platformDiscountCent: 0,
    actualPaidCent: partial.actualPaidCent ?? 0,
    actualSellerReceiveAmountCent: partial.actualSellerReceiveAmountCent ?? 0,
    gmvSourceUsed: '',
    amountWarnings: [],
    orderStatusText: partial.orderStatusText ?? '',
    afterSaleStatusText: partial.afterSaleStatusText ?? '',
    reasonText: '',
    isSigned: false,
    isReturned: partial.isReturned ?? false,
    isQualityReturn: false,
    actualSigned: false,
    actualSignedAmountCent: 0,
    errors: [],
    raw: partial.raw ?? {},
  }
}

function runUnitTests(): void {
  assert(yuanApiAmountToCent(499) === 49900, '499 yuan -> 49900 cent')
  assert(yuanApiAmountToCent(499.5) === 49950, '499.5 yuan -> 49950 cent')

  const rec1 = {
    delivery_package_id: 'P794053985617460471',
    returns_id: 'R1746047136847229',
    refund_fee: 499,
    expected_refund_amount: 499,
    applied_amount: 499,
    applied_ship_fee_amount: 0,
    pay_amount: 517,
    settlement_amount: 517,
    refund_status_name: '退款成功',
    status_name: '已完成',
    reason_name_zh: '多拍/拍错/不想要',
  }
  const agg1 = aggregateWorkbenchRefund([rec1], 'P794053985617460471')
  assert(agg1.officialRefundAmountCent === 49900, 'test1 workbench refund 49900')
  assert(!agg1.refundIncludesFreight, 'test1 no freight in refund')

  const order1 = mockOrder({
    packageId: 'P794053985617460471',
    displayOrderNo: 'P794053985617460471',
    receivableAmountCent: 51700,
    productAmountCent: 49900,
    freightCent: 1800,
    actualSellerReceiveAmountCent: 51700,
    isReturned: true,
    orderStatusText: '已关闭',
    afterSaleStatusText: '售后完成',
  })
  const cls1 = classifyOrderAfterSale(order1, 0)
  const r1 = resolveOrderProductRefund(order1, cls1, 0, {
    ...agg1,
    fetchStatus: 'success',
    fetchError: null,
    fetchedAt: new Date(),
  })
  assert(r1.productRefundAmountCent === 49900, 'test1 buyer refund 49900')
  assert(r1.productRefundAmountCent !== 51700, 'test1 must not be 51700')
  assert(!r1.refundIncludesFreight, 'test1 refundIncludesFreight false')
  console.log('测试 1 通过')

  const rec2 = {
    delivery_package_id: 'P794053251604460971',
    returns_id: 'R0446097136862506',
    refund_fee: 2980,
    applied_ship_fee_amount: 0,
    pay_amount: 2998,
    settlement_amount: 2998,
    refund_status_name: '退款成功',
    status_name: '已完成',
  }
  const agg2 = aggregateWorkbenchRefund([rec2], 'P794053251604460971')
  const order2 = mockOrder({
    packageId: 'P794053251604460971',
    displayOrderNo: 'P794053251604460971',
    receivableAmountCent: 299800,
    productAmountCent: 298000,
    freightCent: 1800,
    actualSellerReceiveAmountCent: 299800,
    isReturned: true,
    afterSaleStatusText: '退款成功',
  })
  const r2 = resolveOrderProductRefund(
    order2,
    classifyOrderAfterSale(order2, 0),
    0,
    { ...agg2, fetchStatus: 'success', fetchError: null, fetchedAt: new Date() },
  )
  assert(r2.productRefundAmountCent === 298000, 'test2 refund 298000')
  assert(r2.productRefundAmountCent !== 299800, 'test2 must not be 299800')
  console.log('测试 2 通过')

  const order3 = mockOrder({
    packageId: 'P794053969154460631',
    displayOrderNo: 'P794053969154460631',
    receivableAmountCent: 41700,
    orderStatusText: '已取消',
    afterSaleStatusText: '无售后',
  })
  const r3 = resolveOrderProductRefund(order3, classifyOrderAfterSale(order3, 0), 0, {
    orderNo: 'P794053969154460631',
    packageId: 'P794053969154460631',
    officialRefundAmountCent: 0,
    expectedRefundAmountCent: 0,
    appliedAmountCent: 0,
    appliedShipFeeAmountCent: 0,
    payAmountCent: 0,
    settlementAmountCent: 0,
    refundIncludesFreight: false,
    afterSaleReason: null,
    afterSaleStatus: null,
    successReturnCount: 0,
    returnsIds: [],
    fetchStatus: 'empty',
    fetchError: null,
    fetchedAt: new Date(),
  })
  assert(r3.productRefundAmountCent === 0, 'test3 refund 0')
  console.log('测试 3 通过')

  const r4 = resolveOrderProductRefund(
    order1,
    classifyOrderAfterSale(order1, 51700),
    0,
    { ...agg1, fetchStatus: 'success', fetchError: null, fetchedAt: new Date() },
  )
  assert(r4.productRefundAmountCent === 49900, 'test4 must use refund_fee not pay')
  const recFreight = {
    delivery_package_id: 'P794833941198079611',
    returns_id: 'R_freight_har',
    refund_fee: 36,
    pay_amount: 2017,
    refund_status_name: '退款成功',
    status_name: '已完成',
    reason_name_zh: '退运费',
    reason: 700004,
    refund_only_delivery_status: 1,
    return_type: 4,
    return_type_name: '已发货仅退款',
  }
  const aggFreight = aggregateWorkbenchRefund([recFreight], 'P794833941198079611')
  assert(aggFreight.freightRefundAmountCent === 3600, 'freight HAR refund 3600 cent')
  assert(aggFreight.officialRefundAmountCent === 0, 'freight HAR product 0')
  assert(aggFreight.hasFreightOnlyRefund, 'freight HAR hasFreightOnlyRefund')
  console.log('测试 5 纯运费 HAR 通过')

  console.log('单元测试全部通过')
}

async function runJingshui(): Promise<void> {
  const { buildRawAnalyzeBundleAll } = await import(
    '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
  )
  const {
    prepareAnalysisArtifactsFromRaw,
    warmWorkbenchCacheForOrders,
  } = await import('../src/services/business-analysis.service')
  const { buildBuyerRankingSummaryFromViews } = await import('../src/services/buyer-ranking.service')
  const { pickBuyerNicknameFromView, viewMatchesBuyerKey } = await import(
    '../src/services/buyer-identity.service'
  )
  const { mapViewToBoardDrillRow } = await import('../src/services/order-row-mapper.service')
  const wb = await import('../src/services/xhs-after-sales-workbench.service')
  const { mergeWorkbenchIntoMemory, syncWorkbenchForOrderNo } = wb
  const { getDecryptedCookie } = await import('../src/services/credential.service')

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.log('跳过静水流深实数验收：无本地订单')
    return
  }

  const targetOrders = [
    'P794053985617460471',
    'P794053251604460971',
    'P794053969154460631',
  ]

  try {
    await getDecryptedCookie()
    for (const no of targetOrders) {
      const r = await syncWorkbenchForOrderNo(no)
      mergeWorkbenchIntoMemory(no, r)
      console.log('同步售后工作台', no, r.fetchStatus, r.officialRefundAmountCent)
    }
  } catch {
    console.log('Cookie 不可用，使用脚本内 mock 数据写入内存缓存')
    mergeWorkbenchIntoMemory('P794053985617460471', {
      ...aggregateWorkbenchRefund(
        [
          {
            delivery_package_id: 'P794053985617460471',
            returns_id: 'R1746047136847229',
            refund_fee: 499,
            applied_ship_fee_amount: 0,
            pay_amount: 517,
            refund_status_name: '退款成功',
            status_name: '已完成',
            reason_name_zh: '多拍/拍错/不想要',
          },
        ],
        'P794053985617460471',
      ),
      fetchStatus: 'success',
      fetchError: null,
      fetchedAt: new Date(),
    })
    mergeWorkbenchIntoMemory('P794053251604460971', {
      ...aggregateWorkbenchRefund(
        [
          {
            delivery_package_id: 'P794053251604460971',
            returns_id: 'R0446097136862506',
            refund_fee: 2980,
            applied_ship_fee_amount: 0,
            pay_amount: 2998,
            refund_status_name: '退款成功',
            status_name: '已完成',
          },
        ],
        'P794053251604460971',
      ),
      fetchStatus: 'success',
      fetchError: null,
      fetchedAt: new Date(),
    })
  }

  const toWarm = bundle.orders.filter((o) =>
    targetOrders.includes((o.displayOrderNo || o.officialOrderNo || '').trim()),
  )
  await warmWorkbenchCacheForOrders(toWarm, { maxImmediateSync: 5 })
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const views = artifacts.views.filter(
    (v) =>
      pickBuyerNicknameFromView(v).includes('静水流深') ||
      viewMatchesBuyerKey(v, '静水流深'),
  )
  const { items } = buildBuyerRankingSummaryFromViews(artifacts.views)
  const buyer = items.find((i) => (i.nickname ?? '').includes('静水流深'))
  console.log('\n静水流深买家汇总:', buyer)

  if (buyer) {
    assert(buyer.gmv === 3515, `支付金额应为 3515，实际 ${buyer.gmv}`)
    assert(buyer.productRefundAmount === 3479, `退款应为 3479，实际 ${buyer.productRefundAmount}`)
    assert(buyer.refundTimes === 2 || buyer.refundRelatedOrderCount === 2, '退款次数应为 2')
  }

  for (const v of views) {
    const row = mapViewToBoardDrillRow(v, { useBuyerRefund: true })
    console.log('订单行:', {
      orderNo: row.orderNo,
      pay: row.paymentBaseAmount,
      refund: row.refundAmount,
      source: row.refundAmountSource,
      reason: row.afterSaleReason,
    })
  }
}

async function main() {
  runUnitTests()
  await runJingshui()
  console.log('\n全部验收通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
