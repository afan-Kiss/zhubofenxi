/**
 * 榜单中心验收（纯函数 + schema）
 * 用法: npm run accept:operations-rankings
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import { isDailyReportSoldOrder } from '../src/services/daily-report-order.util'
import { OPERATIONS_ANCHOR_RANKING } from '../src/config/operations-anchor-ranking.config'
import { OPERATIONS_PRODUCT_RANKING } from '../src/config/operations-product-ranking.config'
import { resolvePriceBandLabelFromCent } from '../src/config/operations-price-band.config'
import type { DailyOperationsAnchorRow } from '../src/services/daily-operations-report.service'
import { buildAfterSalesItemsFromViews } from '../src/services/daily-operations-report.service'
import {
  buildAnchorRankingsByDealConversion,
  buildAnchorRankingsByHourlyAmount,
  buildAnchorRankingsByReturnRate,
  buildAnchorRankingsByAmount,
} from '../src/services/operations-anchor-ranking.service'
import {
  buildHotProductRankings,
  buildHighReturnProductRankings,
  buildSlowProductRankings,
  sortHotProducts,
} from '../src/services/operations-product-ranking.service'
import { buildProductRankingLists } from '../src/services/operations-product-ranking-lists.service'
import type { OperationsProductRow } from '../src/services/operations-product-analysis.service'
import { buildPriceBandRankingLists } from '../src/services/operations-price-band-ranking.service'
import type { OperationsPriceBandRow } from '../src/services/operations-price-band.service'
import { buildAfterSalesRankingLists } from '../src/services/operations-after-sales-ranking.service'
import {
  aggregateAfterSalesReasons,
  normalizeAfterSalesReason,
} from '../src/services/after-sales-reason-normalize.service'
import {
  buildOperationsDailyTrendFromSnapshots,
  detectSuspiciousDailyTrendRepeat,
} from '../src/services/operations-daily-trend.service'
import type { DailyOperationsReportPayload } from '../src/services/daily-operations-report.service'
import type {
  AnchorRankItem,
  ProductRankListItem,
} from '../src/services/operations-rankings.types'

function mockDailySnapshot(
  date: string,
  validAmountYuan: number,
  soldOrderCount: number,
): DailyOperationsReportPayload {
  return {
    startDate: date,
    endDate: date,
    dateLabel: date,
    summary: {
      validAmountYuan,
      soldOrderCount,
      invalidOrderCount: 0,
      returnOrderCount: 0,
      returnOrderRate: null,
      avgOrderAmountYuan: null,
      totalLiveDurationMinutes: 0,
      totalLiveHours: null,
      hourlyAmountYuan: null,
      totalNewFollowerCount: 0,
      newFollowerRate: null,
      dealUserCount: null,
      joinUserCount: null,
      viewSessionCount: null,
      dealConversionRate: null,
      avgOnlineUserCount: null,
      avgViewDurationSeconds: null,
    },
    anchors: [],
    products: [],
    priceBands: [],
    afterSalesReasons: [],
    liveRoomNewFollowers: [],
    reviewNote: null,
    businessInsights: { items: [], dataQuality: { reliable: false, warnings: [] } },
    rankings: {} as DailyOperationsReportPayload['rankings'],
  }
}

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockAnchor(overrides: Partial<DailyOperationsAnchorRow> & { anchorName: string }): DailyOperationsAnchorRow {
  return {
    anchorName: overrides.anchorName,
    sessionLabel: overrides.sessionLabel ?? '场次',
    shopName: overrides.shopName ?? '店',
    livePeriodText: '—',
    liveDurationText: '60分钟',
    liveDurationMinutes: overrides.liveDurationMinutes ?? 60,
    validAmountYuan: overrides.validAmountYuan ?? 0,
    soldOrderCount: overrides.soldOrderCount ?? 0,
    paidOrderCount: overrides.paidOrderCount ?? overrides.soldOrderCount ?? 0,
    invalidOrderCount: 0,
    returnOrderCount: overrides.returnOrderCount ?? 0,
    returnOrderRate: null,
    avgOrderAmountYuan: null,
    hourlyAmountYuan: overrides.hourlyAmountYuan ?? null,
    amountRatio: null,
    viewSessionCount: overrides.viewSessionCount ?? null,
    joinUserCount: overrides.joinUserCount ?? null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: overrides.newFollowerCount ?? null,
    dealUserCount: overrides.dealUserCount ?? null,
    dealConversionRate: overrides.dealConversionRate ?? null,
    newFollowerRate: null,
  }
}

function mockProduct(overrides: Partial<OperationsProductRow> & { productKey: string }): OperationsProductRow {
  const soldOrderCount = overrides.soldOrderCount ?? 0
  const paidOrderCount = overrides.paidOrderCount ?? soldOrderCount
  return {
    productKey: overrides.productKey,
    itemId: overrides.productKey,
    productName: overrides.productName ?? overrides.productKey,
    skuName: overrides.skuName ?? '',
    shopName: overrides.shopName ?? '店',
    productCode: overrides.productCode ?? null,
    ringSize: '未识别',
    barType: '未识别',
    soldCount: overrides.soldCount ?? 0,
    soldOrderCount,
    paidOrderCount,
    soldAmountYuan: overrides.soldAmountYuan ?? 0,
    buyerCount: overrides.buyerCount ?? 0,
    returnOrderCount: overrides.returnOrderCount ?? 0,
    returnRate: overrides.returnRate ?? null,
    productRole: 'normal',
    productRoleLabel: overrides.productRoleLabel ?? '常规',
  }
}

function testAnchorReturnRatePaidDenominator(issues: string[]) {
  const row = mockAnchor({
    anchorName: 'R',
    paidOrderCount: 10,
    soldOrderCount: 3,
    returnOrderCount: 2,
  })
  const ret = buildAnchorRankingsByReturnRate([row])
  const item = ret.items[0]
  assert(item != null, '10 支付单应进正式退货榜', issues)
  assert(item!.returnRate === 2 / 10, '主播 returnRate 必须是 2/10', issues)
  assert(item!.rankReason.includes('2/10'), 'rankReason 必须包含 2/10', issues)
  assert(!item!.rankReason.includes('2/3'), 'rankReason 不允许包含 2/3', issues)
  assert(typeof item!.paidOrderCount === 'number', 'AnchorRankItem 必须有 paidOrderCount', issues)
}

function testAnchorRankings(issues: string[]) {
  testAnchorReturnRatePaidDenominator(issues)

  const rows = [
    mockAnchor({ anchorName: 'A', validAmountYuan: 100, soldOrderCount: 2 }),
    mockAnchor({ anchorName: 'B', validAmountYuan: 200, soldOrderCount: 1 }),
  ]
  const byAmount = buildAnchorRankingsByAmount(rows)
  assert(byAmount.items[0]!.anchorName === 'B', '主播金额榜第一应为 B', issues)

  const hourly = buildAnchorRankingsByHourlyAmount([
    mockAnchor({ anchorName: '短', liveDurationMinutes: 20, validAmountYuan: 1000, hourlyAmountYuan: 3000 }),
    mockAnchor({ anchorName: '长', liveDurationMinutes: 60, validAmountYuan: 1000, hourlyAmountYuan: 1000 }),
  ])
  assert(!hourly.items.some((i) => i.anchorName === '短'), '直播<30min 不进正式每小时榜', issues)
  assert(hourly.sampleTooSmall?.some((i) => i.anchorName === '短'), '短时长应进参考区', issues)

  const deal = buildAnchorRankingsByDealConversion([
    mockAnchor({
      anchorName: 'C',
      joinUserCount: 100,
      dealUserCount: 10,
      dealConversionRate: 0.1,
    }),
    mockAnchor({ anchorName: 'D', joinUserCount: 100, dealUserCount: null, dealConversionRate: null }),
  ])
  assert(deal.items[0]!.anchorName === 'C', '成交率榜应仅有有效官方字段主播', issues)
  assert(!deal.items.some((i) => i.anchorName === 'D'), 'dealUserCount 缺失不进成交率榜', issues)

  const ret = buildAnchorRankingsByReturnRate([
    mockAnchor({ anchorName: 'R1', paidOrderCount: 3, returnOrderCount: 2 }),
    mockAnchor({ anchorName: 'R2', paidOrderCount: 2, returnOrderCount: 2 }),
  ])
  assert(ret.items.some((i) => i.anchorName === 'R1'), '3 支付单应进正式退货榜', issues)
  assert(!ret.items.some((i) => i.anchorName === 'R2'), '2 支付单不进正式退货榜', issues)
}

function testProductReturnRatePaidDenominator(issues: string[]) {
  const product = mockProduct({
    productKey: 'p-rate',
    paidOrderCount: 10,
    soldOrderCount: 3,
    returnOrderCount: 2,
    returnRate: 2 / 10,
    soldAmountYuan: 100,
  })
  const { formal } = buildHighReturnProductRankings([product])
  const item = formal[0]
  assert(item != null, '高退货正式榜应有样本', issues)
  assert(item!.returnRate === 2 / 10, '商品 returnRate 必须是 2/10', issues)
  assert(item!.rankReason.includes('2/10'), '高退货 rankReason 必须包含 2/10', issues)
  assert(!item!.rankReason.includes('2/3'), '高退货 rankReason 不允许包含 2/3', issues)
}

function testProductRankings(issues: string[]) {
  testProductReturnRatePaidDenominator(issues)

  const pool = [
    mockProduct({ productKey: 'a', soldAmountYuan: 100, soldOrderCount: 2, soldCount: 3 }),
    mockProduct({ productKey: 'b', soldAmountYuan: 200, soldOrderCount: 1, soldCount: 5 }),
    mockProduct({ productKey: 'z', soldAmountYuan: 0, soldOrderCount: 0 }),
  ]
  const hot = buildHotProductRankings(pool)
  assert(hot[0]!.productKey === 'b', '热卖金额优先', issues)
  assert(!hot.some((h) => h.productKey === 'z'), '无效成交不进热卖', issues)

  const sorted = [...pool.filter((p) => p.soldOrderCount > 0 && p.soldAmountYuan > 0)].sort(sortHotProducts)
  assert(sorted[0]!.productKey === 'b', 'sortHotProducts 金额优先', issues)

  const closed = {
    orderId: 'c1',
    effectiveGmvCent: 10000,
    includedInGmv: true,
    orderStatusText: '已关闭',
    productRefundAmountCent: 0,
    isFreightRefundOnly: false,
  } as AnalyzedOrderView
  assert(!isDailyReportSoldOrder(closed), '关闭单不计有效成交', issues)

  const { formal, sampleTooSmall } = buildHighReturnProductRankings([
    mockProduct({
      productKey: 'hr1',
      paidOrderCount: 3,
      returnOrderCount: 2,
      returnRate: 2 / 3,
      soldAmountYuan: 100,
    }),
    mockProduct({
      productKey: 'hr2',
      paidOrderCount: 2,
      returnOrderCount: 2,
      returnRate: 1,
      soldAmountYuan: 100,
    }),
  ])
  assert(
    formal.every((p) => p.paidOrderCount >= OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn),
    '高退货正式榜门槛按支付订单',
    issues,
  )
  assert(sampleTooSmall.some((p) => p.productKey === 'hr2'), '低样本进 sampleTooSmall', issues)

  const slow = buildSlowProductRankings({ products: pool, dimensions: [], reviewNote: null })
  assert(slow.items.length === 0, '无候选池不生成滞销', issues)
  assert(slow.dataQuality.basis === 'insufficient_data', '滞销 basis insufficient', issues)
}

function testProductLimit(issues: string[]) {
  const products: OperationsProductRow[] = []
  for (let i = 0; i < 20; i++) {
    products.push(
      mockProduct({
        productKey: `hot-${i}`,
        soldAmountYuan: 1000 - i,
        soldOrderCount: 1,
        productCode: `CODE-${i}`,
        buyerCount: 1,
        productRoleLabel: '常规',
      }),
    )
  }
  const hot15 = buildHotProductRankings(products, 15)
  assert(hot15.length === 15, 'limit=15 时热卖榜应返回 15 条', issues)

  const highReturnProducts: OperationsProductRow[] = []
  for (let i = 0; i < 8; i++) {
    highReturnProducts.push(
      mockProduct({
        productKey: `hr-${i}`,
        paidOrderCount: 5,
        returnOrderCount: 2 + i,
        returnRate: (2 + i) / 5,
        soldAmountYuan: 100,
      }),
    )
  }
  const { formal: high8 } = buildHighReturnProductRankings(highReturnProducts, 8)
  assert(high8.length === 8, 'limit=8 时高退货榜应返回 8 条，不应被 5 条截断', issues)

  const lists = buildProductRankingLists({
    products,
    dimensions: [],
    reviewNote: null,
    limit: 15,
  })
  assert(lists.hot.items.length === 15, 'buildProductRankingLists limit=15 热卖', issues)
  assert(lists.byAmount.items.length === 15, 'byAmount 应与 hot 同批数据', issues)
  const item = lists.hot.items[0] as ProductRankListItem
  assert(typeof item.paidOrderCount === 'number', 'ProductRankListItem 含 paidOrderCount', issues)
  assert(typeof item.productCode === 'string' || item.productCode === null, 'ProductRankListItem 含 productCode', issues)
  assert(typeof item.buyerCount === 'number', 'ProductRankListItem 含 buyerCount', issues)
  assert(typeof item.productRoleLabel === 'string', 'ProductRankListItem 含 productRoleLabel', issues)
}

function testPriceBandRankings(issues: string[]) {
  assert(resolvePriceBandLabelFromCent(199899) === '1600~1998', '1998.99 cent 边界', issues)
  assert(resolvePriceBandLabelFromCent(199900) === '1999+', '1999 cent 边界', issues)

  const rows: OperationsPriceBandRow[] = [
    {
      bandLabel: '400~599',
      orderCount: 3,
      paidOrderCount: 10,
      amountYuan: 2000,
      buyerCount: 4,
      amountSharePercent: 50,
      avgOrderAmountYuan: 400,
      returnOrderCount: 2,
      returnRate: 2 / 10,
    },
  ]
  const lists = buildPriceBandRankingLists(rows)
  const ret = lists.byReturnRate.items[0]
  assert(ret != null && ret.productReturnOrderRate === 2 / 10, '价格带退货率用支付订单维度 2/10', issues)
  assert(ret!.paidOrderCount === 10, 'PriceBandRankItem 含 paidOrderCount', issues)

  const zeroPaid: OperationsPriceBandRow[] = [
    {
      bandLabel: '600~799',
      orderCount: 0,
      paidOrderCount: 0,
      amountYuan: 0,
      buyerCount: 0,
      amountSharePercent: null,
      avgOrderAmountYuan: null,
      returnOrderCount: 0,
      returnRate: null,
    },
  ]
  const zeroLists = buildPriceBandRankingLists(zeroPaid)
  assert(
    zeroLists.byReturnRate.items.every((i) => i.productReturnOrderRate == null),
    'paidOrderCount=0 时退货率为 null',
    issues,
  )
}

function testAfterSalesRankings(issues: string[]) {
  const norm = normalizeAfterSalesReason('尺寸不合适')
  assert(norm.category === 'size_mismatch', '售后归一化', issues)

  const zeroRefundView = {
    orderId: 'as1',
    productRefundAmountCent: 0,
    isReturnRefund: true,
    isFreightRefundOnly: false,
    afterSalesWorkbenchReason: '尺寸不合适',
    paymentBaseCent: 10000,
  } as AnalyzedOrderView
  const items = buildAfterSalesItemsFromViews([zeroRefundView])
  assert(items.length === 1, 'productRefundAmountCent=0 但 isReturnRefund 应进售后原因榜', issues)

  const aggregated = aggregateAfterSalesReasons(items)
  assert(aggregated[0]!.orderCount === 1, '售后原因榜 orderCount=1', issues)

  const lists = buildAfterSalesRankingLists([
    {
      category: 'size_mismatch',
      categoryLabel: '尺寸不符',
      orderCount: 3,
      refundAmountYuan: 500,
      sharePercent: 60,
    },
  ])
  assert(lists.byReason.items[0]!.orderCount === 3, '售后订单榜', issues)
  const json = JSON.stringify(lists.byReason.items)
  const forbidden = ['phone', 'mobile', 'address', 'receiver', 'buyerName', 'platformRawJson', 'rawJson']
  for (const f of forbidden) {
    assert(!json.includes(f), `售后榜不应含 ${f}`, issues)
  }

  const freightOnly = {
    orderId: 'f1',
    productRefundAmountCent: 0,
    isFreightRefundOnly: true,
    isReturnRefund: true,
    afterSalesWorkbenchReason: '运费补偿',
  } as AnalyzedOrderView
  assert(
    buildAfterSalesItemsFromViews([freightOnly]).length === 0,
    '纯运费补偿不进商品售后原因榜',
    issues,
  )
}

function testTypeFields(issues: string[]) {
  const anchor = buildAnchorRankingsByReturnRate([
    mockAnchor({ anchorName: 'T', paidOrderCount: 5, returnOrderCount: 1 }),
  ]).items[0] as AnchorRankItem | undefined
  assert(anchor != null, 'anchor item exists', issues)
  assert(typeof anchor!.paidOrderCount === 'number', 'anchor paidOrderCount', issues)
  assert(
    anchor!.followerConversionRate == null || typeof anchor!.followerConversionRate === 'number',
    'anchor followerConversionRate',
    issues,
  )
}

function testDailyTrendHelpers(issues: string[]) {
  const trend = buildOperationsDailyTrendFromSnapshots(
    [mockDailySnapshot('2026-06-01', 100, 2), mockDailySnapshot('2026-06-03', 50, 1)],
    { startDate: '2026-06-01', endDate: '2026-06-03' },
  )
  assert(trend.length === 3, 'dailyTrend 应补齐日期', issues)
  assert(trend[0]!.validAmountYuan === 100, 'dailyTrend 第1天金额', issues)
  assert(trend[1]!.validAmountYuan === 0, 'dailyTrend 无数据日补 0', issues)
  assert(trend[1]!.soldOrderCount === 0, 'dailyTrend 无数据日订单补 0', issues)
  assert(trend[2]!.validAmountYuan === 50, 'dailyTrend 第3天金额', issues)

  const repeated = [
    { date: 'a', validAmountYuan: 100, soldOrderCount: 5, productReturnOrderCount: 0, productReturnRate: null },
    { date: 'b', validAmountYuan: 100, soldOrderCount: 5, productReturnOrderCount: 0, productReturnRate: null },
    { date: 'c', validAmountYuan: 100, soldOrderCount: 5, productReturnOrderCount: 0, productReturnRate: null },
  ]
  assert(detectSuspiciousDailyTrendRepeat(repeated), '应检出连续相同 trend', issues)
  assert(
    !detectSuspiciousDailyTrendRepeat([
      { date: 'a', validAmountYuan: 100, soldOrderCount: 5, productReturnOrderCount: 0, productReturnRate: null },
      { date: 'b', validAmountYuan: 80, soldOrderCount: 4, productReturnOrderCount: 0, productReturnRate: null },
    ]),
    '不同天不应误报',
    issues,
  )
}

function main() {
  const issues: string[] = []
  testAnchorRankings(issues)
  testProductRankings(issues)
  testProductLimit(issues)
  testPriceBandRankings(issues)
  testAfterSalesRankings(issues)
  testTypeFields(issues)
  testDailyTrendHelpers(issues)

  if (issues.length > 0) {
    console.error('[operations-rankings-acceptance] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[operations-rankings-acceptance] OK')
}

main()
