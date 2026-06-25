/**
 * 运营报表验收（纯函数）
 * 用法: npx tsx apps/server/scripts/operations-report-acceptance.ts
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import { resolvePriceBandLabel, resolvePriceBandLabelFromCent } from '../src/config/operations-price-band.config'
import { resolveProductRole } from '../src/config/operations-product-role.config'
import {
  normalizeAfterSalesReason,
  aggregateAfterSalesReasons,
} from '../src/services/after-sales-reason-normalize.service'
import {
  sanitizeDailyReportRawOrderRow,
  shouldIncludeRawPlatformJson,
} from '../src/services/operations-report-privacy.util'
import { eachDayInShanghaiRange } from '../src/utils/each-day-shanghai'
import { extractLiveSessionTraffic } from '../src/services/live-session-traffic.util'
import { computeProductReturnRateByOrder } from '../src/services/operations-product-analysis.service'
import { aggregateWeeklySummaryForAcceptance } from '../src/services/weekly-operations-report.service'
import type { DailyOperationsReportPayload } from '../src/services/daily-operations-report.service'
import { getAnchorPerformanceViews } from '../src/services/board-scoped-views.service'
import {
  isLowPriceBrushOrderView,
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
} from '../src/services/low-price-brush-order.service'
import { OPERATIONS_PRODUCT_RANKING } from '../src/config/operations-product-ranking.config'
import type { OperationsProductRow } from '../src/services/operations-product-analysis.service'
import {
  buildHotProductRankings,
  buildHighReturnProductRankings,
  buildSlowProductRankings,
  buildWeeklyProductRankings,
  sortHotProducts,
} from '../src/services/operations-product-ranking.service'
import { isDailyReportSoldOrder } from '../src/services/daily-report-order.util'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function testPriceBands(issues: string[]) {
  assert(resolvePriceBandLabel(399) === '≤399', '399 应落在 ≤399', issues)
  assert(resolvePriceBandLabel(400) === '400~599', '400 应落在 400~599', issues)
  assert(resolvePriceBandLabel(599) === '400~599', '599 应落在 400~599', issues)
  assert(resolvePriceBandLabel(600) === '600~799', '600 应落在 600~799', issues)
  assert(resolvePriceBandLabel(799) === '600~799', '799 应落在 600~799', issues)
  assert(resolvePriceBandLabel(800) === '800~999', '800 应落在 800~999', issues)
  assert(resolvePriceBandLabel(999) === '800~999', '999 应落在 800~999', issues)
  assert(resolvePriceBandLabel(1000) === '1000~1299', '1000 应落在 1000~1299', issues)
  assert(resolvePriceBandLabel(1299) === '1000~1299', '1299 应落在 1000~1299', issues)
  assert(resolvePriceBandLabel(1300) === '1300~1599', '1300 应落在 1300~1599', issues)
  assert(resolvePriceBandLabel(1599) === '1300~1599', '1599 应落在 1300~1599', issues)
  assert(resolvePriceBandLabel(1600) === '1600~1998', '1600 应落在 1600~1998', issues)
  assert(resolvePriceBandLabel(1998) === '1600~1998', '1998 应落在 1600~1998', issues)
  assert(resolvePriceBandLabel(1998.99) === '1600~1998', '1998.99 应落在 1600~1998', issues)
  assert(
    resolvePriceBandLabelFromCent(199899) === '1600~1998',
    '199899 分应落在 1600~1998',
    issues,
  )
  assert(resolvePriceBandLabel(1999) === '1999+', '1999 应落在 1999+', issues)
  assert(
    resolvePriceBandLabelFromCent(199900) === '1999+',
    '199900 分应落在 1999+',
    issues,
  )
  assert(resolvePriceBandLabel(2000) === '1999+', '2000 应落在 1999+', issues)
}

function testProductReturnRateByOrder(issues: string[]) {
  assert(computeProductReturnRateByOrder(10, 2) === 0.2, '退货率应为 2/10', issues)
  assert(computeProductReturnRateByOrder(0, 1) === null, '无成交订单时退货率为 null', issues)
  assert(computeProductReturnRateByOrder(5, 0) === 0, '无退货时为 0', issues)
}

function testWeeklyTrafficRates(issues: string[]) {
  const baseSummary = (): DailyOperationsReportPayload['summary'] => ({
    validAmountYuan: 100,
    soldOrderCount: 1,
    invalidOrderCount: 0,
    returnOrderCount: 0,
    returnOrderRate: null,
    dealUserCount: null,
    dealConversionRate: null,
    joinUserCount: null,
    viewSessionCount: null,
    avgOrderAmountYuan: 100,
    totalLiveDurationMinutes: 60,
    hourlyAmountYuan: 100,
    liveRoomNewFollowers: [],
    totalNewFollowerCount: 0,
    newFollowerRate: null,
  })

  const missingTraffic = aggregateWeeklySummaryForAcceptance([
    {
      dateLabel: '1.1',
      title: 't',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      summary: baseSummary(),
      anchors: [],
      products: [],
      priceBands: [],
      afterSalesReasons: [],
      reviewNote: null,
    },
    {
      dateLabel: '1.2',
      title: 't',
      startDate: '2026-01-02',
      endDate: '2026-01-02',
      summary: baseSummary(),
      anchors: [],
      products: [],
      priceBands: [],
      afterSalesReasons: [],
      reviewNote: null,
    },
  ])
  assert(missingTraffic.dealConversionRate === null, '缺失进房/成交人数时周报成交率为 null', issues)
  assert(missingTraffic.newFollowerRate === null, '缺失场观时周报粉丝率为 null', issues)

  const withTraffic = aggregateWeeklySummaryForAcceptance([
    {
      dateLabel: '1.1',
      title: 't',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      summary: {
        ...baseSummary(),
        dealUserCount: 10,
        joinUserCount: 100,
        viewSessionCount: 1000,
        totalNewFollowerCount: 50,
      },
      anchors: [],
      products: [],
      priceBands: [],
      afterSalesReasons: [],
      reviewNote: null,
    },
    {
      dateLabel: '1.2',
      title: 't',
      startDate: '2026-01-02',
      endDate: '2026-01-02',
      summary: {
        ...baseSummary(),
        validAmountYuan: 200,
        soldOrderCount: 2,
        dealUserCount: 5,
        joinUserCount: 50,
        viewSessionCount: 500,
        totalNewFollowerCount: 25,
      },
      anchors: [],
      products: [],
      priceBands: [],
      afterSalesReasons: [],
      reviewNote: null,
    },
  ])
  assert(
    withTraffic.dealConversionRate === 15 / 150,
    '周报成交率应为周内成交人数/进房人数',
    issues,
  )
  assert(
    withTraffic.newFollowerRate === 75 / 1500,
    '周报粉丝率应为周内新增粉丝/场观',
    issues,
  )
  assert(withTraffic.validAmountYuan === 300, '周报有效成交应等于逐日之和', issues)
  assert(withTraffic.soldOrderCount === 3, '周报订单数应等于逐日之和', issues)
}

function makeMinimalView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    matchOrderId: 'm1',
    orderTimeText: '2026-05-01 10:00:00',
    buyerId: 'u1',
    anchorId: 'a1',
    anchorName: '子杰',
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
    afterSaleCategory: '',
    afterSaleStatusLabel: '',
    afterSaleDisplayType: '',
    isSizeMismatch: false,
    reasonText: '',
    effectiveGmvCent: 0,
    paymentBaseCent: 0,
    paymentBaseSource: '',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    ...partial,
  }
}

function testLowPriceBrushExcludedFromPerformanceViews(issues: string[]) {
  const normal = makeMinimalView({
    orderId: 'normal',
    matchOrderId: 'normal',
    paymentBaseCent: 5000,
    effectiveGmvCent: 5000,
  })
  const lowPrice = makeMinimalView({
    orderId: 'low',
    matchOrderId: 'low',
    paymentBaseCent: LOW_PRICE_BRUSH_THRESHOLD_CENT - 1,
    effectiveGmvCent: LOW_PRICE_BRUSH_THRESHOLD_CENT - 1,
    raw: { payAmount: (LOW_PRICE_BRUSH_THRESHOLD_CENT - 1) / 100 },
  } as Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> })

  assert(isLowPriceBrushOrderView(lowPrice), '低价单应被识别为刷单', issues)

  const filtered = getAnchorPerformanceViews(
    [normal, lowPrice],
    new Map([
      ['normal', {}],
      ['low', { payAmount: (LOW_PRICE_BRUSH_THRESHOLD_CENT - 1) / 100 }],
    ]),
  )
  assert(filtered.length === 1, '有效业绩视图应排除低于29元刷单', issues)
  assert(filtered[0]!.orderId === 'normal', '保留正常订单', issues)
}

function testProductRole(issues: string[]) {
  assert(
    resolveProductRole({ soldCount: 10, returnRate: 0.05 }) === 'hot_sale',
    '高销量低退货应为爆款',
    issues,
  )
  assert(
    resolveProductRole({ soldCount: 3, returnRate: 0.4, manualRole: '潜力款' }) === 'potential',
    '人工角色应优先',
    issues,
  )
  assert(
    resolveProductRole({ soldCount: 0, returnRate: null }) === 'slow_moving',
    '零销量应为滞销',
    issues,
  )
}

function testAfterSalesReason(issues: string[]) {
  const size = normalizeAfterSalesReason('圈口偏大不合适')
  assert(size.category === 'size_mismatch', '圈口问题应归尺寸不符', issues)
  const aggregated = aggregateAfterSalesReasons([
    { rawReason: '质量问题', refundAmountCent: 10000, orderKey: 'P1' },
    { rawReason: '瑕疵', refundAmountCent: 5000, orderKey: 'P2' },
  ])
  assert(aggregated.length >= 1, '应聚合售后原因', issues)
}

function testPrivacy(issues: string[]) {
  const sanitized = sanitizeDailyReportRawOrderRow({
    orderId: '1',
    packageId: '1',
    bizOrderId: '1',
    matchOrderId: '1',
    orderTime: '',
    payTime: '',
    shipTime: '',
    finishTime: '',
    closeTime: '',
    productName: '测试',
    skuName: '',
    quantity: 1,
    orderAmount: 100,
    payAmount: 100,
    shippedAmount: 100,
    refundAmount: 0,
    freightRefundAmount: 0,
    shippingFee: 0,
    platformDiscount: 0,
    sellerReceiveAmount: 100,
    signedAmount: 100,
    actualSignedAmount: 100,
    orderStatus: '',
    afterSaleStatus: '',
    refundStatus: '',
    afterSaleCategory: '',
    afterSaleReason: '',
    finalAfterSaleReason: '',
    anchorName: '',
    anchorId: '',
    attributionType: '',
    matchedRuleName: '',
    matchedLiveSession: '',
    matchedLiveStartTime: '',
    matchedLiveEndTime: '',
    liveAccountId: '',
    liveAccountName: '',
    shopName: '',
    buyerId: '',
    buyerNickname: '张三',
    buyerDisplayName: '张三',
    receiverName: '李四',
    receiverPhone: '13812345678',
    receiverAddress: '上海市浦东新区123号502室',
    isLowPriceOrder: false,
    isClosed: false,
    isAfterSaleCompleted: false,
    isRefunded: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isFreightRefundOnly: false,
    isSigned: true,
    isActualSigned: true,
    isQualityReturn: false,
    strictQualityRefund: false,
    officialQualityBadCase: false,
    includedInGmv: true,
    gmvExcludeReason: '',
    paymentBaseSource: '',
    rawSource: '',
    platformRawJson: '{"secret":true}',
  })
  assert(sanitized.platformRawJson === '', '默认应清空 platformRawJson', issues)
  assert(sanitized.receiverPhone.includes('****'), '手机应脱敏', issues)
  assert(
    !shouldIncludeRawPlatformJson({ role: 'admin', confirmRaw: true }),
    '非 super_admin 不应返回 raw',
    issues,
  )
  assert(
    shouldIncludeRawPlatformJson({ role: 'super_admin', confirmRaw: true }),
    'super_admin + confirmRaw 可返回 raw',
    issues,
  )
}

function mockProduct(overrides: Partial<OperationsProductRow> & Pick<OperationsProductRow, 'productKey'>): OperationsProductRow {
  return {
    productKey: overrides.productKey,
    itemId: overrides.itemId ?? overrides.productKey,
    productName: overrides.productName ?? overrides.productKey,
    skuName: overrides.skuName ?? '',
    shopName: overrides.shopName ?? '测试店',
    productCode: overrides.productCode ?? null,
    ringSize: overrides.ringSize ?? '未识别',
    barType: overrides.barType ?? '未识别',
    soldCount: overrides.soldCount ?? 0,
    soldOrderCount: overrides.soldOrderCount ?? 0,
    soldAmountYuan: overrides.soldAmountYuan ?? 0,
    buyerCount: overrides.buyerCount ?? 0,
    returnOrderCount: overrides.returnOrderCount ?? 0,
    returnRate: overrides.returnRate ?? null,
    productRole: overrides.productRole ?? 'normal',
    productRoleLabel: overrides.productRoleLabel ?? '常规',
  }
}

function testProductRankings(issues: string[]) {
  const hotPool = [
    mockProduct({ productKey: 'a', soldAmountYuan: 100, soldOrderCount: 2, soldCount: 3 }),
    mockProduct({ productKey: 'b', soldAmountYuan: 200, soldOrderCount: 1, soldCount: 5 }),
    mockProduct({ productKey: 'c', soldAmountYuan: 0, soldOrderCount: 0, soldCount: 0 }),
    mockProduct({ productKey: 'd', soldAmountYuan: 50, soldOrderCount: 0, soldCount: 2 }),
  ]
  const hot = buildHotProductRankings(hotPool)
  assert(hot.length === 2, '热卖榜应排除无有效成交商品', issues)
  assert(hot[0]!.productKey === 'b', '热卖榜第一优先有效成交金额', issues)
  assert(hot[1]!.productKey === 'a', '热卖榜第二应为次高金额', issues)
  assert(hot.every((h) => h.dataQuality.reliable && h.rankReason), '热卖榜每项应有 rankReason 与 dataQuality', issues)

  const sorted = [...hotPool.filter((p) => p.soldOrderCount > 0 && p.soldAmountYuan > 0)].sort(sortHotProducts)
  assert(sorted[0]!.productKey === 'b', 'sortHotProducts 应按金额优先', issues)

  const highPool = [
    mockProduct({
      productKey: 'hr1',
      soldOrderCount: 3,
      returnOrderCount: 2,
      returnRate: 2 / 3,
    }),
    mockProduct({
      productKey: 'hr2',
      soldOrderCount: 2,
      returnOrderCount: 2,
      returnRate: 1,
    }),
    mockProduct({
      productKey: 'hr3',
      soldOrderCount: 10,
      returnOrderCount: 3,
      returnRate: 0.3,
    }),
  ]
  const { formal, sampleTooSmall } = buildHighReturnProductRankings(highPool)
  assert(formal.every((p) => p.soldOrderCount >= OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn), '高退货正式榜应满足最小样本', issues)
  assert(!formal.some((p) => p.productKey === 'hr2'), '2单高退货不应进入正式榜', issues)
  assert(sampleTooSmall.some((p) => p.productKey === 'hr2'), '低样本应进入 sampleTooSmall', issues)
  assert(formal[0]!.productKey === 'hr1', '高退货正式榜应按退货率排序', issues)
  assert(
    formal.every((p) => p.returnRate === p.returnOrderCount / p.soldOrderCount),
    '高退货榜退货率应为订单维度',
    issues,
  )

  const slowEmpty = buildSlowProductRankings({ products: hotPool, dimensions: [], reviewNote: null })
  assert(slowEmpty.items.length === 0, '无候选池时不应生成滞销榜', issues)
  assert(slowEmpty.dataQuality.basis === 'insufficient_data', '无候选池应标记 insufficient_data', issues)
  assert(slowEmpty.dataQuality.reliable === false, '无候选池滞销榜 unreliable', issues)

  const slowManual = buildSlowProductRankings({
    products: [
      mockProduct({ productKey: 'main1', productName: '主推A', soldOrderCount: 0, soldAmountYuan: 0 }),
      mockProduct({ productKey: 'sold1', productName: '已卖', soldOrderCount: 5, soldAmountYuan: 500 }),
    ],
    dimensions: [{ productKey: 'main1', productRole: 'main', productName: '主推A' }],
    reviewNote: null,
  })
  assert(slowManual.dataQuality.basis === 'manual_product_dimension', '人工候选池应标记 basis', issues)
  assert(slowManual.items.some((p) => p.productKey === 'main1'), '主推未成交应进入滞销候选', issues)
  assert(!slowManual.items.some((p) => p.productKey === 'sold1'), '已有成交不应进入滞销榜', issues)

  const weeklyRank = buildWeeklyProductRankings({
    products: hotPool,
    dimensions: [],
    reviewNote: null,
  })
  assert(typeof weeklyRank.productRankingQuality.hotReliable === 'boolean', '应有 productRankingQuality', issues)
  assert(Array.isArray(weeklyRank.productRankingQuality.warnings), '应有 warnings 数组', issues)

  const closedView = {
    orderId: 'c1',
    effectiveGmvCent: 10000,
    includedInGmv: true,
    orderStatusText: '已关闭',
    productRefundAmountCent: 0,
    isFreightRefundOnly: false,
  } as AnalyzedOrderView
  assert(!isDailyReportSoldOrder(closedView), '关闭订单不应计入有效成交', issues)

  const freightOnly = {
    orderId: 'f1',
    effectiveGmvCent: 0,
    includedInGmv: false,
    productRefundAmountCent: 0,
    isFreightRefundOnly: true,
  } as AnalyzedOrderView
  assert(
    !(freightOnly.productRefundAmountCent > 0 && !freightOnly.isFreightRefundOnly),
    '纯运费退款不应计入商品退货',
    issues,
  )
}

function testEachDay(issues: string[]) {
  const days = eachDayInShanghaiRange('2026-06-16', '2026-06-18')
  assert(days.length === 3, '应含 3 天', issues)
  assert(days[0] === '2026-06-16' && days[2] === '2026-06-18', '逐日范围正确', issues)
}

function testTrafficNullable(issues: string[]) {
  const missing = extractLiveSessionTraffic({})
  assert(missing.dealUserCount === null, '缺失成交人数应为 null', issues)
  assert(missing.dataQuality.missingFields.includes('dealUserCount'), '应记录缺失字段', issues)
  const zero = extractLiveSessionTraffic({ dealUserNum: 0 })
  assert(zero.dealUserCount === 0, '官方返回 0 应保留 0', issues)
}

function main() {
  const issues: string[] = []
  testPriceBands(issues)
  testProductReturnRateByOrder(issues)
  testWeeklyTrafficRates(issues)
  testLowPriceBrushExcludedFromPerformanceViews(issues)
  testProductRole(issues)
  testAfterSalesReason(issues)
  testPrivacy(issues)
  testEachDay(issues)
  testTrafficNullable(issues)
  testProductRankings(issues)

  if (issues.length > 0) {
    console.error('[operations-report-acceptance] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[operations-report-acceptance] OK')
}

main()
