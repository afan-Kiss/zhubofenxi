/**
 * 主播业绩卡片字段顺序、比率与 Drawer 一致性
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import { aggregateViewsMetrics } from '../src/services/board-metrics.service'
import {
  viewCountsAsRefundOrder,
  viewCountsAsPaidOrder,
} from '../src/services/business-metrics.service'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'

const root = path.resolve(__dirname, '../../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

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
    actualSignedAmountCent: 10000,
    orderStatusText: '已完成',
    afterSaleStatusText: '',
    isSigned: true,
    isReturned: false,
    isActualSigned: true,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: false,
    afterSaleCategory: 'none',
    afterSaleStatusLabel: '',
    afterSaleDisplayType: '',
    isSizeMismatch: false,
    reasonText: '',
    effectiveGmvCent: 10000,
    paymentBaseCent: 10000,
    paymentBaseSource: 'actualPaid',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    ...partial,
  } as AnalyzedOrderView
}

function assertPrimaryOrder(tab: string) {
  const gmv = tab.indexOf("label: 'GMV'")
  const signedAmt = tab.indexOf("label: '已签收金额'")
  const paid = tab.indexOf("label: '支付单数'")
  const signedCnt = tab.indexOf("label: '已签收单数'")
  const refundCnt = tab.indexOf("label: '退款单数'")
  const refundRate = tab.indexOf("label: '退款率'")
  assert.ok(gmv >= 0 && signedAmt > gmv && paid > signedAmt && signedCnt > paid && refundCnt > signedCnt && refundRate > refundCnt)
}

function assertMoreOrder(tab: string) {
  const refundAmt = tab.indexOf("label: '退款金额'")
  const returnRefund = tab.indexOf("label: '退货退款单数'")
  const quality = tab.indexOf("label: '品退单数'")
  const signRate = tab.indexOf("label: '签收率'")
  assert.ok(refundAmt >= 0 && returnRefund > refundAmt && quality > returnRefund && signRate > quality)
}

function main() {
  const tab = read('apps/web/src/pages/board/AnchorPerformanceTab.tsx')
  const panel = read('apps/web/src/components/board/AnchorLeaderboardPanel.tsx')
  const mobile = read('apps/web/src/components/board/MobileAnchorLeaderboardCards.tsx')

  assert.match(tab, /ANCHOR_SUMMARY_CARDS/)
  assert.match(tab, /ANCHOR_MORE_SUMMARY_CARDS/)
  assert.match(tab, /onReturnCountClick/)
  assertPrimaryOrder(tab)
  assertMoreOrder(tab)
  console.log('✓ 主播业绩摘要卡字段与顺序')

  assert.match(panel, /onReturnCountClick/)
  assert.match(panel, /退款单数/)
  assert.match(mobile, /onReturnCountClick/)
  assert.match(mobile, /退款单数/)
  assert.doesNotMatch(panel, /退款订单数/)
  assert.doesNotMatch(mobile, /退款订单数/)
  assert.doesNotMatch(panel, /仅退款单数/)
  assert.doesNotMatch(mobile, /仅退款单数/)
  console.log('✓ 手机/电脑主播榜字段与顺序一致')

  const views = [
    baseView({
      displayOrderNo: 'P-PAID-SIGNED',
      officialOrderNo: 'P-PAID-SIGNED',
      matchOrderId: 'P-PAID-SIGNED',
      orderId: 'P-PAID-SIGNED',
      packageId: 'P-PAID-SIGNED',
      isEffectiveSigned: true,
      isActualSigned: true,
      countsForSigned: true,
      actualSignedAmountCent: 12000,
    }),
    baseView({
      displayOrderNo: 'P-PAID-UNSIGNED',
      officialOrderNo: 'P-PAID-UNSIGNED',
      matchOrderId: 'P-PAID-UNSIGNED',
      orderId: 'P-PAID-UNSIGNED',
      packageId: 'P-PAID-UNSIGNED',
      isEffectiveSigned: false,
      isActualSigned: false,
      isSigned: false,
      countsForSigned: false,
      actualSignedAmountCent: 0,
      orderStatusText: '待发货',
    }),
    baseView({
      displayOrderNo: 'P-REFUND',
      officialOrderNo: 'P-REFUND',
      matchOrderId: 'P-REFUND',
      orderId: 'P-REFUND',
      packageId: 'P-REFUND',
      isEffectiveSigned: false,
      isReturned: true,
      isRealProductRefund: true,
      productRefundAmountCent: 3000,
      returnAmountCent: 3000,
      realAfterSaleAmountCent: 3000,
      afterSaleStatusText: '退款成功',
      isActualSigned: false,
      countsForSigned: false,
      actualSignedAmountCent: 0,
    }),
    baseView({
      displayOrderNo: 'P-FREIGHT',
      officialOrderNo: 'P-FREIGHT',
      matchOrderId: 'P-FREIGHT',
      orderId: 'P-FREIGHT',
      packageId: 'P-FREIGHT',
      isEffectiveSigned: false,
      isFreightRefundOnly: true,
      freightRefundAmountCent: 500,
      productRefundAmountCent: 0,
      returnAmountCent: 0,
      afterSaleStatusText: '退款成功',
    }),
  ]

  const metricSets = buildOrderMetricSets(views)
  assert.equal(metricSets.paidOrderCount, 4)
  assert.equal(metricSets.signedOrderCount, 1)
  assert.equal(metricSets.refundOrderCount, 1)
  console.log('✓ metric sets：支付/签收/退款单数口径')

  const metrics = aggregateViewsMetrics(views)
  assert.equal(metrics.orderCount, 4)
  assert.equal(metrics.signedOrderCount, 1)
  assert.equal(metrics.refundOrderCount, 1)
  if (metrics.refundRate == null || Math.abs(metrics.refundRate - 0.25) > 1e-9) {
    throw new Error(`refundRate 期望 0.25，实际 ${metrics.refundRate}`)
  }
  if (metrics.signRate == null || Math.abs(metrics.signRate - 0.25) > 1e-9) {
    throw new Error(`signRate 期望 0.25，实际 ${metrics.signRate}`)
  }
  console.log('✓ 退款单数÷支付单数=退款率；已签收单数÷支付单数=签收率')

  const refundDrawerViews = views.filter((v) => viewCountsAsRefundOrder(v))
  const signedDrawerViews = views.filter(
    (v) => viewCountsAsPaidOrder(v) && isEffectiveSignedView(v),
  )
  assert.equal(refundDrawerViews.length, metrics.refundOrderCount)
  assert.equal(signedDrawerViews.length, metrics.signedOrderCount)
  console.log('✓ 卡片数量 = Drawer 过滤去重数量')

  console.log('\nverify:anchor-performance-card-fields PASS')
}

main()
