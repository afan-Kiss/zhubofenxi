/**
 * 买家订单标准口径（含线下退款类型）确定性验收
 * npm run verify:buyer-order-standard
 */
import assert from 'node:assert/strict'
import { offlineDealToAnalyzedView } from '../src/services/offline-deal.service'
import {
  resolveBuyerAfterSaleType,
  resolveBuyerOrderQualityRefund,
  mapViewToBuyerOrderStandard,
  buyerOrderRowCountsAsRefundOrder,
} from '../src/services/buyer-order-standard.service'
import { viewCountsAsQualityRefund } from '../src/services/quality-refund-resolution.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function offline(partial: {
  refundCent?: number
  note?: string
  amountCent?: number
}): AnalyzedOrderView {
  return offlineDealToAnalyzedView({
    id: 'b-std',
    dealKey: 'OFF-20260714-BUYSTD1',
    amountCent: partial.amountCent ?? 80000,
    refundCent: partial.refundCent ?? 0,
    dealAt: new Date('2026-07-14T12:00:00.000+08:00'),
    status: 'confirmed',
    anchorId: 'a1',
    anchorName: '__TEST_BUYER_STD_ANCHOR__',
    customerLabel: '__TEST_BUYER_STD__',
    note: partial.note ?? null,
  })
}

function onlineQuality(reason: string): AnalyzedOrderView {
  return {
    orderId: 'P_BUY_STD_Q',
    packageId: 'P_BUY_STD_Q',
    displayOrderNo: 'P_BUY_STD_Q',
    officialOrderNo: 'P_BUY_STD_Q',
    matchOrderId: 'P_BUY_STD_Q',
    orderTimeText: '2026-07-14 12:00:00',
    buyerId: 'b1',
    anchorId: 'a1',
    anchorName: '飞云',
    attributionType: 'time_rule',
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
    actualSignedAmountCent: 10000,
    orderStatusText: '已签收',
    afterSaleStatusText: '退款成功',
    isSigned: true,
    isReturned: true,
    isActualSigned: true,
    productRefundAmountCent: 10000,
    successfulRefundAmountCent: 10000,
    reasonText: reason,
    afterSalesWorkbenchReason: reason,
    finalAfterSaleReason: reason,
    paymentBaseCent: 10000,
    paymentBaseSource: 'test',
    includedInGmv: true,
    dealSource: 'online',
    sourceType: 'order_list',
  } as AnalyzedOrderView
}

function main(): void {
  console.log('verify:buyer-order-standard\n')

  const none = offline({ note: '买断' })
  assert.equal(resolveBuyerAfterSaleType(none), 'none')
  assert.equal(resolveBuyerOrderQualityRefund(none).isQualityRefund, false)
  assert.equal(viewCountsAsQualityRefund(none), false)

  const refund = offline({ refundCent: 10000, note: '线下退款备注' })
  assert.equal(resolveBuyerAfterSaleType(refund), 'offline_refund')
  const row = mapViewToBuyerOrderStandard(refund)
  assert.equal(row.afterSaleType, 'offline_refund')
  assert.equal(row.afterSaleTypeLabel, '线下退款')
  assert.equal(row.isQualityRefund, false)
  assert.equal(buyerOrderRowCountsAsRefundOrder(row), true)
  assert.notEqual(row.afterSaleType, 'return_refund')
  assert.notEqual(row.afterSaleType, 'refund_only')

  const q = onlineQuality('质量问题')
  assert.equal(viewCountsAsQualityRefund(q), true)
  assert.equal(resolveBuyerAfterSaleType(q), 'return_refund')

  console.log('verify:buyer-order-standard OK')
}

main()
