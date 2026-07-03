/**
 * 主播周榜验收（纯函数 + mock 视图）
 * 用法: npm run verify:anchor-buyer-weekly-ranking
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import { buildBuyerRankingSummaryFromViews } from '../src/services/buyer-ranking.service'
import { filterBuyerRankingByTab } from '../src/services/buyer-ranking-tab-filters'
import {
  mapBuyerRankingItemToWeekly,
  resolveAnchorWeeklyRankingScope,
  sortAnchorWeeklyRankingItems,
} from '../src/services/anchor-buyer-weekly-ranking.service'
import { resolveBuyerRankingDateRange } from '../src/utils/buyer-ranking-date-range'
import type { BuyerRankingItem } from '../src/services/buyer-ranking.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockPaidView(input: {
  suffix: string
  buyerId: string
  anchorName: string
  payCent: number
  orderTime: string
  refundCent?: number
  quality?: boolean
  freightOnly?: boolean
}): AnalyzedOrderView & { raw: Record<string, unknown> } {
  const refundCent = input.refundCent ?? 0
  const freightOnly = input.freightOnly === true
  return {
    orderId: `oid-${input.suffix}`,
    packageId: `pkg-${input.suffix}`,
    bizOrderId: `biz-${input.suffix}`,
    displayOrderNo: `P${input.suffix}`,
    officialOrderNo: `P${input.suffix}`,
    matchOrderId: `oid-${input.suffix}`,
    orderTimeText: input.orderTime,
    buyerId: input.buyerId,
    anchorId: `aid-${input.anchorName}`,
    anchorName: input.anchorName,
    attributionType: 'schedule',
    gmvCent: input.payCent,
    productAmountCent: input.payCent,
    receivableAmountCent: input.payCent,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: input.payCent,
    actualSellerReceiveAmountCent: input.payCent,
    actualSignedAmountCent: input.payCent,
    orderStatusText: '已完成',
    afterSaleStatusText: refundCent > 0 ? '退款成功' : '—',
    isSigned: true,
    isReturned: false,
    isActualSigned: true,
    isQualityReturn: input.quality === true,
    returnAmountCent: refundCent,
    productRefundAmountCent: freightOnly ? 0 : refundCent,
    buyerProductRefundAmountCent: freightOnly ? 0 : refundCent,
    freightRefundAmountCent: freightOnly ? refundCent : 0,
    realAfterSaleAmountCent: refundCent,
    isFreightRefundOnly: freightOnly,
    afterSaleClosedNoRefund: false,
    isReturnRefund: refundCent > 0 && !freightOnly,
    isRefundOnly: false,
    isRealProductRefund: refundCent > 0 && !freightOnly,
    afterSaleCategory: '—',
    afterSaleStatusLabel: '—',
    afterSaleDisplayType: '—',
    isSizeMismatch: false,
    reasonText: input.quality ? '商品质量问题' : '',
    effectiveGmvCent: input.payCent,
    paymentBaseCent: input.payCent,
    paymentBaseSource: 'mock',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    statPaidAmountCent: input.payCent,
    officialPaidAmountCent: input.payCent,
    officialPaidConfirmed: true,
    buyerReceivableAmountCent: input.payCent,
    strictQualityRefund: input.quality === true,
    officialQualityBadCase: input.quality === true,
    raw: {
      status: 7,
      orderStatus: '已完成',
      payTime: input.orderTime,
    },
  }
}

function mockItem(overrides: Partial<BuyerRankingItem> & { buyerKey: string }): BuyerRankingItem {
  return {
    buyerKey: overrides.buyerKey,
    buyerId: overrides.buyerId ?? overrides.buyerKey,
    nickname: overrides.nickname ?? '测试买家',
    orderCount: overrides.orderCount ?? 1,
    signedOrderCount: 0,
    unsignedOrderCount: 0,
    completedOrderCount: 0,
    returnRefundCount: 0,
    refundOnlyCount: 0,
    freightRefundCount: 0,
    afterSaleClosedNoRefundCount: 0,
    gmv: overrides.gmv ?? 100,
    signedAmount: 0,
    productRefundAmount: overrides.productRefundAmount ?? 0,
    freightRefundAmount: overrides.freightRefundAmount ?? 0,
    actualDealAmount: overrides.actualDealAmount ?? 100,
    earnedAmount: overrides.earnedAmount ?? 100,
    qualityReturnCount: overrides.qualityReturnCount ?? 0,
    refundRelatedOrderCount: 0,
    refundTimes: 0,
    sizeMismatchCount: 0,
    lastOrderTime: overrides.lastOrderTime ?? '2026-07-02 12:00:00',
    customerTags: overrides.customerTags ?? [],
    customerTag: '—',
    isBlacklisted: false,
    suggestion: '—',
    riskScore: 0,
    buyerSummary: overrides.buyerSummary ?? {
      receivableAmountCent: 10000,
      payAmountCent: 10000,
      refundAmountCent: 0,
      freightRefundAmountCent: 0,
      netDealAmountCent: 10000,
      realDealAmountCent: 10000,
      displayEarnedAmountCent: 10000,
      orderCount: 1,
      paidOrderCount: 1,
      realDealOrderCount: overrides.buyerSummary?.realDealOrderCount ?? 1,
      refundOrderCount: 0,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
    },
    ...overrides,
  }
}

function main() {
  const issues: string[] = []

  const buyerId = 'buyer-shared-001'
  const views = [
    mockPaidView({
      suffix: 'a1',
      buyerId,
      anchorName: '主播A',
      payCent: 10_000,
      orderTime: '2026-07-01 10:00:00',
    }),
    mockPaidView({
      suffix: 'a2',
      buyerId,
      anchorName: '主播A',
      payCent: 10_000,
      orderTime: '2026-07-02 10:00:00',
    }),
    mockPaidView({
      suffix: 'b1',
      buyerId,
      anchorName: '主播B',
      payCent: 15_000,
      orderTime: '2026-07-01 11:00:00',
    }),
    mockPaidView({
      suffix: 'b2',
      buyerId,
      anchorName: '主播B',
      payCent: 15_000,
      orderTime: '2026-07-02 11:00:00',
    }),
    mockPaidView({
      suffix: 'b3',
      buyerId,
      anchorName: '主播B',
      payCent: 15_000,
      orderTime: '2026-07-03 11:00:00',
    }),
  ]

  const itemsA = buildBuyerRankingSummaryFromViews(
    views.filter((v) => v.anchorName === '主播A'),
  ).items
  const buyerA = itemsA[0]
  assert(
    buyerA != null && (buyerA.buyerSummary?.realDealOrderCount ?? 0) === 2,
    `主播A 应看到买家 X 的 2 单，实际 ${buyerA?.buyerSummary?.realDealOrderCount}`,
    issues,
  )
  assert(
    buyerA != null && (buyerA.buyerSummary?.realDealAmountCent ?? 0) === 20_000,
    `主播A 成交金额应为 200 元，实际 ${(buyerA?.buyerSummary?.realDealAmountCent ?? 0) / 100}`,
    issues,
  )

  const itemsB = buildBuyerRankingSummaryFromViews(
    views.filter((v) => v.anchorName === '主播B'),
  ).items
  const buyerB = itemsB[0]
  assert(
    buyerB != null && (buyerB.buyerSummary?.realDealOrderCount ?? 0) === 3,
    `主播B 应看到买家 X 的 3 单，实际 ${buyerB?.buyerSummary?.realDealOrderCount}`,
    issues,
  )
  assert(
    buyerB != null && (buyerB.buyerSummary?.realDealAmountCent ?? 0) === 45_000,
    `主播B 成交金额应为 450 元，实际 ${(buyerB?.buyerSummary?.realDealAmountCent ?? 0) / 100}`,
    issues,
  )

  const fri = new Date(Date.parse('2026-07-03T12:00:00+08:00'))
  const thisWeek = resolveBuyerRankingDateRange('thisWeek', undefined, undefined, fri)
  const lastWeek = resolveBuyerRankingDateRange('lastWeek', undefined, undefined, fri)
  assert(thisWeek.startDate === '2026-06-29', '本周起始日错误', issues)
  assert(lastWeek.endDate < thisWeek.startDate, '上周结束应早于本周开始', issues)

  const spendItems = sortAnchorWeeklyRankingItems(
    [
      mockItem({
        buyerKey: 'low',
        earnedAmount: 50,
        buyerSummary: {
          receivableAmountCent: 5000,
          payAmountCent: 5000,
          refundAmountCent: 0,
          freightRefundAmountCent: 0,
          netDealAmountCent: 5000,
          realDealAmountCent: 5000,
          displayEarnedAmountCent: 5000,
          orderCount: 1,
          paidOrderCount: 1,
          realDealOrderCount: 1,
          refundOrderCount: 0,
          qualityRefundOrderCount: 0,
          pendingAfterSaleOrderCount: 0,
        },
      }),
      mockItem({
        buyerKey: 'high',
        earnedAmount: 200,
        buyerSummary: {
          receivableAmountCent: 20_000,
          payAmountCent: 20_000,
          refundAmountCent: 0,
          freightRefundAmountCent: 0,
          netDealAmountCent: 20_000,
          realDealAmountCent: 20_000,
          displayEarnedAmountCent: 20_000,
          orderCount: 2,
          paidOrderCount: 2,
          realDealOrderCount: 2,
          refundOrderCount: 0,
          qualityRefundOrderCount: 0,
          pendingAfterSaleOrderCount: 0,
        },
      }),
    ],
    'spend',
  )
  assert(spendItems[0]?.buyerKey === 'high', '成交榜应按成交金额降序', issues)

  const repurchaseItems = sortAnchorWeeklyRankingItems(
    [
      mockItem({
        buyerKey: 'one',
        buyerSummary: {
          receivableAmountCent: 30_000,
          payAmountCent: 30_000,
          refundAmountCent: 0,
          freightRefundAmountCent: 0,
          netDealAmountCent: 30_000,
          realDealAmountCent: 30_000,
          displayEarnedAmountCent: 30_000,
          orderCount: 1,
          paidOrderCount: 1,
          realDealOrderCount: 1,
          refundOrderCount: 0,
          qualityRefundOrderCount: 0,
          pendingAfterSaleOrderCount: 0,
        },
      }),
      mockItem({
        buyerKey: 'two',
        buyerSummary: {
          receivableAmountCent: 10_000,
          payAmountCent: 10_000,
          refundAmountCent: 0,
          freightRefundAmountCent: 0,
          netDealAmountCent: 10_000,
          realDealAmountCent: 10_000,
          displayEarnedAmountCent: 10_000,
          orderCount: 2,
          paidOrderCount: 2,
          realDealOrderCount: 2,
          refundOrderCount: 0,
          qualityRefundOrderCount: 0,
          pendingAfterSaleOrderCount: 0,
        },
      }),
    ],
    'repurchase',
  )
  assert(repurchaseItems[0]?.buyerKey === 'two', '复购榜应按真实成交单数降序', issues)

  const refundViews = [
    mockPaidView({
      suffix: 'rf1',
      buyerId: 'rf-buyer',
      anchorName: '主播A',
      payCent: 10_000,
      orderTime: '2026-07-01 10:00:00',
      refundCent: 5000,
    }),
    mockPaidView({
      suffix: 'fr1',
      buyerId: 'fr-buyer',
      anchorName: '主播A',
      payCent: 10_000,
      orderTime: '2026-07-01 11:00:00',
      refundCent: 800,
      freightOnly: true,
    }),
  ]
  const refundItems = buildBuyerRankingSummaryFromViews(refundViews).items
  const refundTab = filterBuyerRankingByTab(refundItems, 'refund')
  assert(
    refundTab.some((i) => i.buyerKey.includes('rf-buyer') || i.buyerId === 'rf-buyer'),
    '退款榜应包含商品退款客户',
    issues,
  )
  assert(
    !refundTab.some((i) => i.buyerId === 'fr-buyer'),
    '退款榜不应包含纯运费退客户',
    issues,
  )

  const qualityItems = filterBuyerRankingByTab(
    [
      mockItem({
        buyerKey: 'q1',
        qualityReturnCount: 1,
        buyerSummary: {
          receivableAmountCent: 10_000,
          payAmountCent: 10_000,
          refundAmountCent: 10_000,
          freightRefundAmountCent: 0,
          netDealAmountCent: 0,
          realDealAmountCent: 0,
          displayEarnedAmountCent: 0,
          orderCount: 1,
          paidOrderCount: 1,
          realDealOrderCount: 1,
          refundOrderCount: 1,
          qualityRefundOrderCount: 1,
          pendingAfterSaleOrderCount: 0,
        },
      }),
    ],
    'quality',
  )
  assert(qualityItems.length === 1, '品退榜应只统计品退客户', issues)

  const bossScope = resolveAnchorWeeklyRankingScope('boss', 'admin', '主播A')
  assert(
    bossScope.mode === 'anchor' || bossScope.mode === 'all',
    '老板应可指定主播或查看全部',
    issues,
  )

  const staffUnbound = resolveAnchorWeeklyRankingScope('staff', 'random-user-xyz')
  assert(staffUnbound.mode === 'unbound', '未绑定主播的员工应返回 unbound', issues)

  const weeklyRow = mapBuyerRankingItemToWeekly(
    mockItem({
      buyerKey: 'w1',
      buyerSummary: {
        receivableAmountCent: 12_345,
        payAmountCent: 12_345,
        refundAmountCent: 0,
        freightRefundAmountCent: 0,
        netDealAmountCent: 12_345,
        realDealAmountCent: 12_345,
        displayEarnedAmountCent: 12_345,
        orderCount: 1,
        paidOrderCount: 1,
        realDealOrderCount: 1,
        refundOrderCount: 0,
        qualityRefundOrderCount: 0,
        pendingAfterSaleOrderCount: 0,
      },
    }),
    1,
    'spend',
  )
  assert(Math.abs(weeklyRow.weeklyDealAmountYuan - 123.45) < 0.01, '周榜字段映射错误', issues)
  assert(weeklyRow.rank === 1, '周榜序号错误', issues)

  if (issues.length > 0) {
    console.error('[verify:anchor-buyer-weekly-ranking] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:anchor-buyer-weekly-ranking] PASS')
}

main()
