/**
 * 核心指标低价刷单排除验收
 * 用法: npx tsx apps/server/scripts/metrics-exclusion-acceptance.ts
 */
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import {
  filterViewsForCoreMetrics,
  isExcludedFromCoreMetrics,
  describeMetricsExclusionConfig,
} from '../src/services/metrics-exclusion.service'
import { LOW_PRICE_BRUSH_THRESHOLD_CENT } from '../src/services/low-price-brush-order.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: partial.displayOrderNo ?? 'P1',
    officialOrderNo: partial.displayOrderNo ?? 'P1',
    matchOrderId: 'm1',
    orderTimeText: '2026-05-01 10:00:00',
    buyerId: 'u1',
    anchorId: 'a1',
    anchorName: '子杰',
    liveAccountId: 'la1',
    liveAccountName: '主店',
    attributionType: 'time_rule',
    gmvCent: 0,
    productAmountCent: 0,
    receivableAmountCent: 0,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 0,
    actualSellerReceiveAmountCent: 0,
    actualSignedAmountCent: 0,
    orderStatusText: '已完成',
    afterSaleStatusText: '—',
    isSigned: true,
    isReturned: false,
    isActualSigned: false,
    isReturnRefundOrder: false,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    buyerProductRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: false,
    effectiveGmvCent: 0,
    paymentBaseCent: 0,
    includedInGmv: true,
    ...partial,
  }
}

function testThresholdConfig(issues: string[]) {
  assert(LOW_PRICE_BRUSH_THRESHOLD_CENT === 2900, '低价刷单阈值应为 2900 分', issues)
  const meta = describeMetricsExclusionConfig()
  assert(meta.lowPriceBrushThresholdYuan === 29, '导出摘要阈值应为 29 元', issues)
}

function testLowPriceExcluded(issues: string[]) {
  const v = makeView({
    paymentBaseCent: 2100,
    effectiveGmvCent: 2100,
    isEffectiveSigned: true,
    actualSignAmountCent: 2100,
    statusSigned: true,
  })
  assert(isExcludedFromCoreMetrics(v), '21 元应视为低价刷单并排除', issues)
  const metrics = calculateBusinessMetrics(filterViewsForCoreMetrics([v]))
  assert(metrics.actualSignedAmount === 0, '排除后签收额应为 0', issues)
  assert(metrics.orderCount === 0, '排除后支付单数应为 0', issues)
}

function testNormalPriceIncluded(issues: string[]) {
  const v = makeView({
    liveAccountName: '和田雅玉',
    anchorName: '和田雅玉',
    paymentBaseCent: 5000,
    effectiveGmvCent: 5000,
    isEffectiveSigned: true,
    actualSignAmountCent: 5000,
    statusSigned: true,
  })
  assert(!isExcludedFromCoreMetrics(v), '50 元正常单不应排除（不因店铺名排除）', issues)
  const metrics = calculateBusinessMetrics(filterViewsForCoreMetrics([v]))
  assert(metrics.actualSignedAmount === 50, '正常单仍计入签收额', issues)
}

function testBoundary(issues: string[]) {
  assert(isExcludedFromCoreMetrics(makeView({ paymentBaseCent: 2899 })), '28.99 元应排除', issues)
  assert(!isExcludedFromCoreMetrics(makeView({ paymentBaseCent: 2900 })), '29 元应计入', issues)
}

function testMixedFilter(issues: string[]) {
  const kept = filterViewsForCoreMetrics([
    makeView({ paymentBaseCent: 5000 }),
    makeView({ paymentBaseCent: 1000 }),
  ])
  assert(kept.length === 1, '过滤后只剩 1 单正常价订单', issues)
}

function main() {
  const issues: string[] = []
  testThresholdConfig(issues)
  testLowPriceExcluded(issues)
  testNormalPriceIncluded(issues)
  testBoundary(issues)
  testMixedFilter(issues)

  if (issues.length > 0) {
    console.error('[metrics-exclusion-acceptance] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[metrics-exclusion-acceptance] PASSED')
}

main()
