/**
 * 买家价值分（10 分制）验收
 * 用法: npm run verify:buyer-value-score
 */
import {
  buildBuyerValueProfile,
  computeValueScore,
  formatScoreText,
} from '../src/services/buyer-value-profile.service'
import type { BuyerRankingItem } from '../src/services/buyer-ranking.service'

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
    unsignedOrderCount: 0,
    completedOrderCount: partial.completedOrderCount ?? 0,
    returnRefundCount: 0,
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
    buyerSummary: partial.buyerSummary,
    lastOrderTime: partial.lastOrderTime ?? '2026-07-01 12:00:00',
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

  const starBuyer = mockBuyer({
    buyerKey: 'star',
    actualDealAmount: 12000,
    earnedAmount: 12000,
    signedOrderCount: 6,
    completedOrderCount: 5,
    orderCount: 6,
    refundCount: 0,
    lastOrderTime: '2026-07-02 10:00:00',
    buyerSummary: summary({
      displayEarnedAmountCent: 1_200_000,
      realDealAmountCent: 1_200_000,
      realDealOrderCount: 6,
      orderCount: 6,
      paidOrderCount: 6,
      payAmountCent: 1_200_000,
      netDealAmountCent: 1_200_000,
      receivableAmountCent: 1_200_000,
    }),
  })
  const starScore = computeValueScore(starBuyer)
  assert(starScore >= 8.5, `高成交低退款买家应 ≥8.5，实际 ${starScore}`, issues)

  const highAovBuyer = mockBuyer({
    buyerKey: 'aov',
    actualDealAmount: 3500,
    earnedAmount: 3500,
    signedOrderCount: 1,
    completedOrderCount: 1,
    orderCount: 1,
    refundCount: 0,
    buyerSummary: summary({
      displayEarnedAmountCent: 350_000,
      realDealAmountCent: 350_000,
      realDealOrderCount: 1,
      orderCount: 1,
      paidOrderCount: 1,
      payAmountCent: 350_000,
      netDealAmountCent: 350_000,
      receivableAmountCent: 350_000,
    }),
  })
  const aovScore = computeValueScore(highAovBuyer)
  assert(aovScore >= 6 && aovScore <= 8.5, `高客单少单买家应在 6~8.5，实际 ${aovScore}`, issues)

  const refundHeavy = mockBuyer({
    buyerKey: 'refund',
    actualDealAmount: 5000,
    earnedAmount: 5000,
    signedOrderCount: 4,
    completedOrderCount: 2,
    orderCount: 4,
    refundCount: 3,
    afterSaleCount: 3,
    buyerSummary: summary({
      displayEarnedAmountCent: 500_000,
      realDealAmountCent: 500_000,
      realDealOrderCount: 4,
      refundOrderCount: 3,
      orderCount: 4,
      paidOrderCount: 4,
      payAmountCent: 500_000,
      refundAmountCent: 300_000,
      netDealAmountCent: 200_000,
      receivableAmountCent: 500_000,
    }),
  })
  const refundScore = computeValueScore(refundHeavy)
  assert(refundScore < starScore - 2, `高退款买家分数应明显低于优质买家`, issues)

  const qualityHeavy = mockBuyer({
    buyerKey: 'quality',
    actualDealAmount: 8000,
    earnedAmount: 8000,
    signedOrderCount: 5,
    completedOrderCount: 3,
    orderCount: 5,
    refundCount: 3,
    qualityReturnCount: 3,
    afterSaleCount: 3,
    buyerSummary: summary({
      displayEarnedAmountCent: 800_000,
      realDealAmountCent: 800_000,
      realDealOrderCount: 5,
      refundOrderCount: 3,
      qualityRefundOrderCount: 3,
      orderCount: 5,
      paidOrderCount: 5,
      payAmountCent: 800_000,
      refundAmountCent: 400_000,
      netDealAmountCent: 400_000,
      receivableAmountCent: 800_000,
    }),
  })
  const qualityScore = computeValueScore(qualityHeavy)
  assert(qualityScore < starScore - 1.5, `品退多买家分数应明显降低`, issues)

  for (const s of [starScore, aovScore, refundScore, qualityScore, 0]) {
    assert(s >= 0 && s <= 10, `分数应在 0~10，实际 ${s}`, issues)
    const rounded = Math.round(s * 10) / 10
    assert(Math.abs(s - rounded) < 0.001, `分数应保留 1 位小数，实际 ${s}`, issues)
  }

  const profile = buildBuyerValueProfile(starBuyer)
  assert(/^\d+\.\d\/10$/.test(profile.scoreText), `scoreText 格式应为 x.x/10，实际 ${profile.scoreText}`, issues)
  assert(profile.scoreText === formatScoreText(starScore), 'scoreText 应与 computeValueScore 一致', issues)
  assert(profile.scoreReason.length > 0 && profile.scoreReason.length <= 16, 'scoreReason 应简短', issues)
  assert(profile.afterSaleOrderCount >= 0, '应有 afterSaleOrderCount', issues)
  assert(profile.completedOrderCount >= 0, '应有 completedOrderCount', issues)

  if (issues.length > 0) {
    console.error('[verify:buyer-value-score] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:buyer-value-score] PASS')
}

main()
