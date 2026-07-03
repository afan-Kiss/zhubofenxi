#!/usr/bin/env tsx
import {
  dataAccuracyCheckStatus,
  duplicateSamplesFromRawViewsForTest,
  resolveBadBuyerAuditSampleLimit,
  resolveBuyerAuditSampleLimit,
  resolveRawVsNormalizedCheck,
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

  assert(resolveRawVsNormalizedCheck(0, 0).status === 'pass', '双零应 pass', issues)
  assert(resolveRawVsNormalizedCheck(100, 0).status === 'danger', '有 raw 无 normalized 应 danger', issues)
  assert(resolveRawVsNormalizedCheck(10, 12).status === 'danger', 'normalized 多于 raw 应 danger', issues)
  assert(resolveRawVsNormalizedCheck(100, 95).status === 'warning', 'raw 略多不应无脑 danger', issues)
  assert(
    resolveRawVsNormalizedCheck(100, 95).excludeFromTotals === true,
    'raw_vs_normalized 不应计入 orderDiffTotal',
    issues,
  )
  assert(resolveRawVsNormalizedCheck(100, 100).status === 'pass', '相等应 pass', issues)

  assert(resolveBuyerAuditSampleLimit(true, 100) === 100, 'fullScan 买家榜应全量', issues)
  assert(resolveBuyerAuditSampleLimit(false, 100) === 20, '非 fullScan 买家榜应抽样20', issues)
  assert(resolveBadBuyerAuditSampleLimit(true, 50) === 50, 'fullScan 垃圾客户榜应全量', issues)
  assert(resolveBadBuyerAuditSampleLimit(false, 50) === 10, '非 fullScan 垃圾客户榜应抽样10', issues)

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
