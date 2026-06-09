/**
 * 核心指标店铺排除验收
 * 用法: npx tsx apps/server/scripts/metrics-exclusion-acceptance.ts
 */
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import {
  DEFAULT_EXCLUDED_LIVE_ACCOUNT_NAMES,
  DEFAULT_EXCLUDED_SHOP_NAMES,
  DEFAULT_EXCLUDED_STORE_NAMES,
  filterViewsForCoreMetrics,
  getMetricsExclusionConfig,
  isExcludedFromCoreMetrics,
  resetMetricsExclusionConfigCache,
} from '../src/services/metrics-exclusion.service'
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

function testDefaults(issues: string[]) {
  const cfg = getMetricsExclusionConfig()
  assert(cfg.excludedShopNames.includes('和田雅玉'), '默认排除店铺应含和田雅玉', issues)
  assert(cfg.excludedLiveAccountNames.includes('和田雅玉'), '默认排除直播号应含和田雅玉', issues)
  assert(cfg.excludedStoreNames.includes('和田雅玉'), '默认排除门店应含和田雅玉', issues)
  assert(
    DEFAULT_EXCLUDED_SHOP_NAMES.length === 1 && DEFAULT_EXCLUDED_SHOP_NAMES[0] === '和田雅玉',
    '未硬编码其他未知店铺名',
    issues,
  )
}

function testLiveAccountExclusion(issues: string[]) {
  const v = makeView({
    liveAccountName: '和田雅玉',
    paymentBaseCent: 5000,
    effectiveGmvCent: 5000,
    isEffectiveSigned: true,
    actualSignAmountCent: 5000,
    statusSigned: true,
  })
  assert(isExcludedFromCoreMetrics(v), '和田雅玉直播号应排除', issues)
  const metrics = calculateBusinessMetrics(filterViewsForCoreMetrics([v]))
  assert(metrics.actualSignedAmount === 0, '排除后签收额应为 0', issues)
  assert(metrics.orderCount === 0, '排除后支付单数应为 0', issues)
}

function testShopRawExclusion(issues: string[]) {
  const v = makeView({
    liveAccountName: '其他店',
    paymentBaseCent: 9900,
    effectiveGmvCent: 9900,
    isEffectiveSigned: true,
    actualSignAmountCent: 9900,
    statusSigned: true,
    raw: { shopName: '和田雅玉' },
  })
  assert(isExcludedFromCoreMetrics(v), 'raw.shopName=和田雅玉 应排除', issues)
}

function testAnchorNameNotExcluded(issues: string[]) {
  const v = makeView({
    anchorName: '和田雅玉',
    liveAccountName: '主店',
    paymentBaseCent: 3000,
    effectiveGmvCent: 3000,
    isEffectiveSigned: true,
    actualSignAmountCent: 3000,
    statusSigned: true,
  })
  assert(!isExcludedFromCoreMetrics(v), '误归属主播名不应触发店铺排除', issues)
  const metrics = calculateBusinessMetrics(filterViewsForCoreMetrics([v]))
  assert(metrics.actualSignedAmount === 30, '主店订单仍计入签收额', issues)
}

function testEnvOverride(issues: string[]) {
  process.env.METRICS_EXCLUDED_LIVE_ACCOUNT_NAMES = '测试排除店'
  resetMetricsExclusionConfigCache()
  const v = makeView({ liveAccountName: '测试排除店' })
  assert(isExcludedFromCoreMetrics(v), '环境变量应可追加排除直播号', issues)
  delete process.env.METRICS_EXCLUDED_LIVE_ACCOUNT_NAMES
  resetMetricsExclusionConfigCache()
}

function main() {
  const issues: string[] = []
  testDefaults(issues)
  testLiveAccountExclusion(issues)
  testShopRawExclusion(issues)
  testAnchorNameNotExcluded(issues)
  testEnvOverride(issues)

  if (issues.length > 0) {
    console.error('[metrics-exclusion-acceptance] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[metrics-exclusion-acceptance] PASSED')
}

main()
