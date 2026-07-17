/**
 * 品退确定性验收（不依赖 Cookie / 本月真实订单）
 * npm run verify:quality-refund
 */
import assert from 'node:assert/strict'
import { offlineDealToAnalyzedView } from '../src/services/offline-deal.service'
import {
  resolveQualityRefundInfo,
  viewCountsAsQualityRefund,
} from '../src/services/quality-refund-resolution.service'
import { matchPlatformReturnReason } from '../src/utils/quality-return'
import type { AnalyzedOrderView } from '../src/types/analysis'

function online(reason: string, opts?: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'P_QR_FIX',
    packageId: 'P_QR_FIX',
    displayOrderNo: 'P_QR_FIX',
    officialOrderNo: 'P_QR_FIX',
    matchOrderId: 'P_QR_FIX',
    orderTimeText: '2026-07-14 12:00:00',
    buyerId: 'b1',
    anchorId: 'a1',
    anchorName: '__TEST_QR_ANCHOR__',
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
    ...opts,
  } as AnalyzedOrderView
}

function main(): void {
  console.log('verify:quality-refund（fixture）\n')

  assert.equal(matchPlatformReturnReason('商品断裂').isQualityReturn, true)
  assert.equal(viewCountsAsQualityRefund(online('商品断裂')), true)
  assert.equal(viewCountsAsQualityRefund(online('买断')), false)
  assert.equal(viewCountsAsQualityRefund(online('直播断开')), false)

  const official = online('多拍/拍错/不想要', {
    isReturned: false,
    productRefundAmountCent: 0,
    successfulRefundAmountCent: 0,
    reasonText: '',
    afterSalesWorkbenchReason: '',
    finalAfterSaleReason: '',
    officialQualityBadCase: true,
    officialQualityMatchStatus: 'matched_order_only',
    officialQualityReasons: ['做工粗糙/有瑕疵'],
  })
  assert.equal(viewCountsAsQualityRefund(official), true)

  const offline = offlineDealToAnalyzedView({
    id: '1',
    dealKey: 'OFF-20260714-QRFIX',
    amountCent: 80000,
    refundCent: 0,
    dealAt: new Date('2026-07-14T12:00:00.000+08:00'),
    status: 'confirmed',
    anchorId: 'a',
    anchorName: '__TEST_QR_OFF__',
    note: 'zq8366线下成交买断',
  })
  const qi = resolveQualityRefundInfo({ view: offline })
  assert.equal(qi.isQualityRefund, false)
  assert.equal(qi.qualityVerifyStatus, 'none')
  assert.equal(qi.suspectedQualityRefund, false)

  console.log('verify:quality-refund OK')
}

main()
