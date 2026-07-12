/**
 * 主播退货退款单数：metric sets 与卡片口径
 */
import assert from 'node:assert/strict'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import { aggregateViewsMetrics } from '../src/services/board-metrics.service'

function baseView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'P1',
    packageId: 'P1',
    bizOrderId: '',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    matchOrderId: 'P1',
    orderTimeText: '2026-07-01 10:00:00',
    buyerId: 'b1',
    anchorId: 'a1',
    anchorName: '飞云',
    liveAccountId: 'shop1',
    liveAccountName: '测试店',
    attributionType: 'time_rule',
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
    actualSignedAmountCent: 0,
    orderStatusText: '已完成',
    afterSaleStatusText: '退款成功',
    isSigned: true,
    isReturned: true,
    isActualSigned: false,
    isQualityReturn: false,
    returnAmountCent: 5000,
    productRefundAmountCent: 5000,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 5000,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: true,
    afterSaleCategory: 'real_product_refund',
    afterSaleStatusLabel: '退款成功',
    afterSaleDisplayType: '仅退款',
    isSizeMismatch: false,
    reasonText: '',
    effectiveGmvCent: 0,
    paymentBaseCent: 10000,
    paymentBaseSource: 'actualPaid',
    includedInGmv: true,
    countsForSigned: false,
    countsForGrossProfit: false,
    gmvExcludeReason: null,
    ...partial,
  } as AnalyzedOrderView
}

function main() {
  const views = [
    baseView({
      displayOrderNo: 'P-RR',
      officialOrderNo: 'P-RR',
      matchOrderId: 'P-RR',
      orderId: 'P-RR',
      packageId: 'P-RR',
      isReturnRefundOrder: true,
      isRefundOnlyOrder: false,
      isRefundTypeUnknown: false,
      productRefundAmountCent: 21700,
    }),
    baseView({
      displayOrderNo: 'P-RO',
      officialOrderNo: 'P-RO',
      matchOrderId: 'P-RO',
      orderId: 'P-RO',
      packageId: 'P-RO',
      isReturnRefundOrder: false,
      isRefundOnlyOrder: true,
      isRefundTypeUnknown: false,
      productRefundAmountCent: 9900,
    }),
    baseView({
      displayOrderNo: 'P-UK',
      officialOrderNo: 'P-UK',
      matchOrderId: 'P-UK',
      orderId: 'P-UK',
      packageId: 'P-UK',
      isReturnRefundOrder: false,
      isRefundOnlyOrder: false,
      isRefundTypeUnknown: true,
      productRefundAmountCent: 5000,
    }),
    baseView({
      displayOrderNo: 'P-OK',
      officialOrderNo: 'P-OK',
      matchOrderId: 'P-OK',
      orderId: 'P-OK',
      packageId: 'P-OK',
      isReturnRefundOrder: false,
      isRefundOnlyOrder: false,
      isRefundTypeUnknown: false,
      productRefundAmountCent: 0,
      returnAmountCent: 0,
      realAfterSaleAmountCent: 0,
      isReturned: false,
      afterSaleStatusText: '',
    }),
  ]

  const sets = buildOrderMetricSets(views, { scope: 'verify-anchor-return-refund' })
  assert.equal(sets.paidOrderCount, 4)
  assert.equal(sets.refundOrderCount, 3)
  assert.equal(sets.returnOrderCount, 1)
  assert.equal(sets.refundOnlyOrderCount, 1)
  assert.equal(sets.unknownRefundTypeOrderCount, 1)
  assert.equal(sets.returnRefundTypeIncomplete, true)
  console.log('✓ metric sets: 退货1 + 仅退款1 + 未知1')

  const m = aggregateViewsMetrics(views, { scope: 'verify-anchor-return-refund-agg' })
  assert.equal(m.returnRefundCount, 1)
  assert.equal(m.refundOnlyCount, 1)
  assert.equal(m.unknownRefundTypeCount, 1)
  assert.equal(m.returnCount, 3)
  assert.equal(m.returnRefundTypeIncomplete, true)
  console.log('✓ board metrics 映射 returnRefundCount / refundOnlyCount')

  // 同一订单多条售后按订单号只计1单
  const dup = [
    baseView({
      displayOrderNo: 'P-DUP',
      officialOrderNo: 'P-DUP',
      matchOrderId: 'P-DUP',
      orderId: 'P-DUP',
      packageId: 'P-DUP',
      isReturnRefundOrder: true,
      productRefundAmountCent: 10000,
    }),
    baseView({
      displayOrderNo: 'P-DUP',
      officialOrderNo: 'P-DUP',
      matchOrderId: 'P-DUP',
      orderId: 'P-DUP',
      packageId: 'P-DUP',
      isReturnRefundOrder: true,
      productRefundAmountCent: 10000,
    }),
  ]
  const dupSets = buildOrderMetricSets(dup)
  assert.equal(dupSets.returnOrderCount, 1)
  console.log('✓ 同一订单多条售后按订单号只计1单')

  console.log('\nverify:anchor-return-refund-count PASS')
}

main()
