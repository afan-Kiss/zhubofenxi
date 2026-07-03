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
import type { OperationsProductRow } from '../src/services/operations-product-analysis.service'
import { buildPriceBandRankingLists } from '../src/services/operations-price-band-ranking.service'
import type { OperationsPriceBandRow } from '../src/services/operations-price-band.service'
import { buildAfterSalesRankingLists } from '../src/services/operations-after-sales-ranking.service'
import { normalizeAfterSalesReason } from '../src/services/after-sales-reason-normalize.service'
import {
  buildOperationsDailyTrendFromSnapshots,
  detectSuspiciousDailyTrendRepeat,
} from '../src/services/operations-daily-trend.service'
import type { DailyOperationsReportPayload } from '../src/services/daily-operations-report.service'

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
  return {
    productKey: overrides.productKey,
    itemId: overrides.productKey,
    productName: overrides.productName ?? overrides.productKey,
    skuName: overrides.skuName ?? '',
    shopName: overrides.shopName ?? '店',
    productCode: null,
    ringSize: '未识别',
    barType: '未识别',
    soldCount: overrides.soldCount ?? 0,
    soldOrderCount: overrides.soldOrderCount ?? 0,
    soldAmountYuan: overrides.soldAmountYuan ?? 0,
    buyerCount: 0,
    returnOrderCount: overrides.returnOrderCount ?? 0,
    returnRate: overrides.returnRate ?? null,
    productRole: 'normal',
    productRoleLabel: '常规',
  }
}

function testAnchorRankings(issues: string[]) {
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
    mockAnchor({ anchorName: 'R1', soldOrderCount: 3, returnOrderCount: 2 }),
    mockAnchor({ anchorName: 'R2', soldOrderCount: 2, returnOrderCount: 2 }),
  ])
  assert(ret.items.some((i) => i.anchorName === 'R1'), '3单应进正式退货榜', issues)
  assert(!ret.items.some((i) => i.anchorName === 'R2'), '2单不进正式退货榜', issues)
}

function testProductRankings(issues: string[]) {
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
    mockProduct({ productKey: 'hr1', soldOrderCount: 3, returnOrderCount: 2, returnRate: 2 / 3 }),
    mockProduct({ productKey: 'hr2', soldOrderCount: 2, returnOrderCount: 2, returnRate: 1 }),
  ])
  assert(formal.every((p) => p.soldOrderCount >= OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn), '高退货正式榜门槛', issues)
  assert(sampleTooSmall.some((p) => p.productKey === 'hr2'), '低样本进 sampleTooSmall', issues)

  const slow = buildSlowProductRankings({ products: pool, dimensions: [], reviewNote: null })
  assert(slow.items.length === 0, '无候选池不生成滞销', issues)
  assert(slow.dataQuality.basis === 'insufficient_data', '滞销 basis insufficient', issues)
}

function testPriceBandRankings(issues: string[]) {
  assert(resolvePriceBandLabelFromCent(199899) === '1600~1998', '1998.99 cent 边界', issues)
  assert(resolvePriceBandLabelFromCent(199900) === '1999+', '1999 cent 边界', issues)

  const rows: OperationsPriceBandRow[] = [
    {
      bandLabel: '400~599',
      orderCount: 5,
      amountYuan: 2000,
      buyerCount: 4,
      amountSharePercent: 50,
      avgOrderAmountYuan: 400,
      returnOrderCount: 2,
      returnRate: 40,
    },
  ]
  const lists = buildPriceBandRankingLists(rows)
  const ret = lists.byReturnRate.items[0]
  assert(ret != null && ret.productReturnOrderRate === 2 / 5, '价格带退货率用订单维度', issues)
}

function testAfterSalesRankings(issues: string[]) {
  const norm = normalizeAfterSalesReason('尺寸不合适')
  assert(norm.category === 'size_mismatch', '售后归一化', issues)
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
  testPriceBandRankings(issues)
  testAfterSalesRankings(issues)
  testDailyTrendHelpers(issues)

  if (issues.length > 0) {
    console.error('[operations-rankings-acceptance] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[operations-rankings-acceptance] OK')
}

main()
