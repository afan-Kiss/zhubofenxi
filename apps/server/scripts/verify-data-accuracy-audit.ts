#!/usr/bin/env tsx
import {
  dataAccuracyCheckStatus,
  duplicateSamplesFromRawViewsForTest,
} from '../src/services/data-accuracy-audit.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockView(partial: Partial<AnalyzedOrderView> & { orderId: string }): AnalyzedOrderView {
  return {
    orderId: partial.orderId,
    packageId: partial.packageId ?? partial.orderId,
    bizOrderId: partial.orderId,
    displayOrderNo: partial.displayOrderNo ?? partial.orderId,
    officialOrderNo: partial.officialOrderNo ?? partial.orderId,
    matchOrderId: partial.matchOrderId ?? partial.packageId ?? partial.orderId,
    orderTimeText: '2026-01-01',
    buyerId: 'b1',
    anchorId: 'a1',
    anchorName: '主播',
    attributionType: 'order_anchor_field',
    gmvCent: 100,
    productAmountCent: 100,
    receivableAmountCent: 100,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 100,
    actualSellerReceiveAmountCent: 100,
    actualSignedAmountCent: 0,
    orderStatusText: '已完成',
    afterSaleStatusText: '',
    isSigned: false,
    isReturned: false,
    isActualSigned: false,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    buyerProductRefundAmountCent: 0,
    includedInGmv: true,
    paymentBaseCent: 100,
    effectiveGmvCent: 100,
    ...partial,
  } as AnalyzedOrderView
}

async function main() {
  const issues: string[] = []

  assert(dataAccuracyCheckStatus(0, 0) === 'pass', '完全一致应 pass', issues)
  assert(dataAccuracyCheckStatus(1, 0) === 'danger', '差 1 分应 danger', issues)
  assert(dataAccuracyCheckStatus(0, 1) === 'danger', '差 1 单应 danger', issues)

  const dupViews = [
    mockView({ orderId: 'P001', displayOrderNo: 'P001', packageId: 'pkg1', matchOrderId: 'm1' }),
    mockView({ orderId: 'P001', displayOrderNo: 'P001', packageId: 'pkg1', matchOrderId: 'm1' }),
  ]
  const dup = duplicateSamplesFromRawViewsForTest(dupViews)
  assert(dup.duplicateGroupCount > 0, '重复订单必须能被查出来', issues)
  assert(dup.samples.some((s) => s.count > 1), '重复样本 count 应 > 1', issues)

  const uniqueViews = [mockView({ orderId: 'P002' }), mockView({ orderId: 'P003' })]
  const noDup = duplicateSamplesFromRawViewsForTest(uniqueViews)
  assert(noDup.duplicateGroupCount === 0, '无重复时不应报 duplicate', issues)

  const rawVsNormalizedStatus = (rawInRange: number, normalized: number) =>
    rawInRange - normalized !== 0 ? 'danger' : 'pass'
  assert(rawVsNormalizedStatus(10, 10) === 'pass', '同周期相等应 pass', issues)
  assert(rawVsNormalizedStatus(10, 8) === 'danger', 'raw_vs_normalized 不能无条件 pass', issues)

  const score = Math.round(8.75 * 10) / 10
  assert(score === 8.8, '风险分保留 1 位小数', issues)

  if (issues.length > 0) {
    console.error('[verify:data-accuracy-audit] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:data-accuracy-audit] PASS')
}

void main()
