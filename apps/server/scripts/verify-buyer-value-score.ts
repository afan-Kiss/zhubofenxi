/**
 * 高价值客户评分与分类验收
 * 用法: npm run verify:buyer-value-score
 */
import {
  buildBuyerValueProfile,
  computeValueScore,
  formatScoreText,
} from '../src/services/buyer-value-profile.service'
import {
  buildBuyerValueRankingProfile,
  capBuyerValueRate,
  classifyBuyerValueCustomerType,
  computeHighValueScore,
  extractBuyerValueCustomerMetrics,
  isTrueHighValueCustomer,
} from '../src/services/buyer-value-ranking.service'
import { buildHighValueCustomerDefinition } from '../src/services/buyer-ranking-classification'
import type { BuyerRankingItem } from '../src/services/buyer-ranking.service'
import { LOW_PRICE_BRUSH_THRESHOLD_CENT } from '../src/services/low-price-brush-order.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockBuyer(partial: Partial<BuyerRankingItem> & { buyerKey: string }): BuyerRankingItem {
  return {
    buyerKey: partial.buyerKey,
    buyerId: partial.buyerId ?? partial.buyerKey,
    nickname: partial.nickname ?? '测试买家',
    buyerDisplayName: partial.nickname ?? '测试买家',
    orderCount: partial.orderCount ?? 1,
    signedOrderCount: partial.signedOrderCount ?? 0,
    unsignedOrderCount: partial.unsignedOrderCount ?? 0,
    completedOrderCount: partial.completedOrderCount ?? 0,
    returnRefundCount: partial.returnRefundCount ?? 0,
    refundOnlyCount: 0,
    freightRefundCount: 0,
    afterSaleClosedNoRefundCount: 0,
    afterSaleCount: partial.afterSaleCount ?? 0,
    gmv: partial.gmv ?? 0,
    signedAmount: partial.signedAmount ?? 0,
    productRefundAmount: partial.productRefundAmount ?? 0,
    freightRefundAmount: 0,
    actualDealAmount: partial.actualDealAmount ?? 0,
    earnedAmount: partial.earnedAmount ?? 0,
    qualityReturnCount: partial.qualityReturnCount ?? 0,
    refundCount: partial.refundCount ?? 0,
    pendingAfterSaleOrderCount: partial.pendingAfterSaleOrderCount ?? 0,
    buyerSummary: partial.buyerSummary,
    lastOrderTime: partial.lastOrderTime ?? '2026-07-02 10:00:00',
  }
}

function summary(partial: NonNullable<BuyerRankingItem['buyerSummary']>) {
  return {
    realDealAmountCent: 0,
    displayEarnedAmountCent: 0,
    realDealOrderCount: 0,
    refundOrderCount: 0,
    qualityRefundOrderCount: 0,
    orderCount: 0,
    paidOrderCount: 0,
    payAmountCent: 0,
    refundAmountCent: 0,
    receivableAmountCent: 0,
    netDealAmountCent: 0,
    pendingAfterSaleOrderCount: 0,
    ...partial,
  }
}

function main() {
  const issues: string[] = []
  const now = Date.parse('2026-07-03T12:00:00+08:00')

  const trueHighValue = mockBuyer({
    buyerKey: 'tv1',
    signedOrderCount: 3,
    unsignedOrderCount: 0,
    signedAmount: 12800,
    buyerSummary: summary({
      paidOrderCount: 3,
      payAmountCent: 1_280_000,
      realDealOrderCount: 3,
      realDealAmountCent: 1_280_000,
      displayEarnedAmountCent: 1_280_000,
      netDealAmountCent: 1_280_000,
      orderCount: 3,
      refundOrderCount: 0,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 1_280_000,
    }),
  })
  const tvProfile = buildBuyerValueRankingProfile(trueHighValue, undefined, { now })
  assert(tvProfile.customerType === 'true_high_value', '3单签收无退款应属真正高价值', issues)
  assert(isTrueHighValueCustomer(trueHighValue), 'isTrueHighValueCustomer 应通过', issues)

  const highSpendRisk = mockBuyer({
    buyerKey: 'hr1',
    signedOrderCount: 4,
    unsignedOrderCount: 0,
    signedAmount: 10000,
    buyerSummary: summary({
      paidOrderCount: 4,
      payAmountCent: 2_000_000,
      realDealOrderCount: 2,
      realDealAmountCent: 1_000_000,
      displayEarnedAmountCent: 1_000_000,
      netDealAmountCent: 1_000_000,
      orderCount: 4,
      refundOrderCount: 2,
      refundAmountCent: 1_000_000,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 2_000_000,
    }),
  })
  const hrProfile = buildBuyerValueRankingProfile(highSpendRisk, undefined, { now })
  assert(
    hrProfile.customerType === 'high_spend_need_attention',
    '支付高但50%退款应属高消费但需关注',
    issues,
  )
  assert(!isTrueHighValueCustomer(highSpendRisk), '高退款不应进入真正高价值', issues)

  const potential = mockBuyer({
    buyerKey: 'pot1',
    signedOrderCount: 1,
    unsignedOrderCount: 0,
    signedAmount: 2000,
    buyerSummary: summary({
      paidOrderCount: 1,
      payAmountCent: 200_000,
      realDealOrderCount: 1,
      realDealAmountCent: 200_000,
      displayEarnedAmountCent: 200_000,
      netDealAmountCent: 200_000,
      orderCount: 1,
      refundOrderCount: 0,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 200_000,
    }),
  })
  const potProfile = buildBuyerValueRankingProfile(potential, undefined, { now })
  assert(potProfile.customerType === 'potential_customer', '首单高客单无售后应属潜力客户', issues)
  assert(potProfile.customerType !== 'true_high_value', '首单不应进真正高价值', issues)

  const multiAftersale = extractBuyerValueCustomerMetrics(
    mockBuyer({
      buyerKey: 'ma1',
      orderCount: 1,
      buyerSummary: summary({
        paidOrderCount: 1,
        payAmountCent: 100_000,
        refundOrderCount: 1,
        refundAmountCent: 100_000,
        orderCount: 1,
        realDealOrderCount: 0,
        realDealAmountCent: 0,
        displayEarnedAmountCent: 0,
        netDealAmountCent: 0,
        receivableAmountCent: 100_000,
      }),
    }),
    undefined,
    { aftersaleApplyCount: 3 },
  )
  assert(multiAftersale.refundOrderCount === 1, '多次售后 refund_order_count 仍应为 1', issues)
  assert(multiAftersale.aftersaleCount === 3, 'aftersale_count 可累计', issues)
  assert(
    capBuyerValueRate(multiAftersale.refundOrderCount, multiAftersale.paidOrderCount) === 1,
    '退款率最高 100%',
    issues,
  )

  assert(LOW_PRICE_BRUSH_THRESHOLD_CENT === 2900, '低价刷单阈值应为 2900 分', issues)

  const highValueDef = buildHighValueCustomerDefinition()
  assert(highValueDef.amountThreshold === 3000, '高价值签收金额阈值应为 3000', issues)
  assert(highValueDef.orderCountThreshold === 2, '高价值签收单数阈值应为 2', issues)
  assert(
    highValueDef.ruleText.includes('3000') && highValueDef.ruleText.includes('2'),
    '高价值规则文案应与真实阈值一致',
    issues,
  )

  const unsignedOnly = mockBuyer({
    buyerKey: 'un1',
    signedOrderCount: 0,
    unsignedOrderCount: 2,
    buyerSummary: summary({
      paidOrderCount: 2,
      payAmountCent: 200_000,
      realDealOrderCount: 0,
      realDealAmountCent: 0,
      orderCount: 2,
      receivableAmountCent: 200_000,
    }),
  })
  const unMetrics = extractBuyerValueCustomerMetrics(unsignedOnly)
  assert(unMetrics.validOrderCount === 0, '未签收不应计入 valid_order_count', issues)
  assert(unMetrics.signedOrderCount === 0, '未签收 signed_count 应为 0', issues)

  const pendingAftersale = mockBuyer({
    buyerKey: 'pa1',
    signedOrderCount: 1,
    buyerSummary: summary({
      paidOrderCount: 1,
      payAmountCent: 100_000,
      realDealOrderCount: 0,
      realDealAmountCent: 0,
      pendingAfterSaleOrderCount: 1,
      orderCount: 1,
      receivableAmountCent: 100_000,
    }),
  })
  assert(
    extractBuyerValueCustomerMetrics(pendingAftersale).validOrderCount === 0,
    '售后处理中不计入有效成交',
    issues,
  )

  const starBuyer = mockBuyer({
    buyerKey: 'star',
    signedOrderCount: 6,
    signedAmount: 12000,
    buyerSummary: summary({
      paidOrderCount: 6,
      payAmountCent: 1_200_000,
      realDealOrderCount: 6,
      realDealAmountCent: 1_200_000,
      displayEarnedAmountCent: 1_200_000,
      netDealAmountCent: 1_200_000,
      orderCount: 6,
      receivableAmountCent: 1_200_000,
    }),
  })
  const starScore = computeValueScore(starBuyer)
  assert(starScore >= 0 && starScore <= 10, '价值分应在 0~10', issues)

  const profile = buildBuyerValueProfile(starBuyer)
  assert(profile.scoreText === formatScoreText(starScore), 'scoreText 一致', issues)
  assert(profile.refundRate == null || profile.refundRate <= 1, '退款率应封顶 1', issues)

  for (const s of [starScore, computeHighValueScore(extractBuyerValueCustomerMetrics(starBuyer)), 0, 10]) {
    assert(s >= 0 && s <= 10, `分数 ${s} 应在 0~10`, issues)
  }

  if (issues.length > 0) {
    console.error('[verify:buyer-value-score] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:buyer-value-score] PASS')
}

main()
