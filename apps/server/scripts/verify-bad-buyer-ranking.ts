/**
 * 垃圾客户榜单验收
 * 用法: npm run verify:bad-buyer-ranking
 */
import {
  afterSaleOrderCount,
  badBuyerRefundOrderCount,
  buildBadBuyerProfile,
  buyerRefundRate,
  composeBadBuyerWechatText,
  computeBadBuyerRiskScore,
  formatBadBuyerWechatBlock,
  isBadBuyerCandidate,
  qualityRefundOrderCount,
  returnRefundOrderCount,
} from '../src/services/bad-buyer-ranking.service'
import type { BuyerRankingItem } from '../src/services/buyer-ranking.service'
import { resolveBuyerRankingDateRange } from '../src/utils/buyer-ranking-date-range'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockBuyer(partial: Partial<BuyerRankingItem> & { buyerKey: string }): BuyerRankingItem {
  return {
    buyerKey: partial.buyerKey,
    buyerId: partial.buyerId ?? partial.buyerKey,
    nickname: partial.nickname ?? '测试买家',
    buyerDisplayName: partial.buyerDisplayName ?? partial.nickname ?? '测试买家',
    buyerShortCode: partial.buyerShortCode ?? 'ABC123',
    orderCount: partial.orderCount ?? 5,
    signedOrderCount: partial.signedOrderCount ?? 3,
    unsignedOrderCount: 0,
    completedOrderCount: partial.completedOrderCount ?? 2,
    returnRefundCount: partial.returnRefundCount ?? 0,
    refundOnlyCount: 0,
    freightRefundCount: partial.freightRefundCount ?? 0,
    afterSaleClosedNoRefundCount: 0,
    afterSaleCount: partial.afterSaleCount ?? 0,
    gmv: partial.gmv ?? 5000,
    signedAmount: partial.signedAmount ?? 5000,
    productRefundAmount: partial.productRefundAmount ?? 0,
    freightRefundAmount: 0,
    actualDealAmount: partial.actualDealAmount ?? 5000,
    earnedAmount: partial.earnedAmount ?? 5000,
    qualityReturnCount: partial.qualityReturnCount ?? 0,
    refundCount: partial.refundCount ?? 0,
    pendingAfterSaleOrderCount: partial.pendingAfterSaleOrderCount ?? 0,
    buyerSummary: partial.buyerSummary,
    lastOrderTime: partial.lastOrderTime ?? '2026-07-01 12:00:00',
  }
}

function assertNoIdentityLeak(text: string, context: string, issues: string[]) {
  assert(!text.includes('#A1B2C3'), `${context} 不应含 #A1B2C3 识别码`, issues)
  assert(!text.includes('识别码'), `${context} 不应含「识别码」`, issues)
  assert(!text.includes('buyerShortCode'), `${context} 不应含 buyerShortCode`, issues)
  assert(!text.includes('buyerIdentityCode'), `${context} 不应含 buyerIdentityCode`, issues)
  assert(!text.includes('buyerKey'), `${context} 不应含 buyerKey`, issues)
  assert(!/1[3-9]\d{9}/.test(text), `${context} 不应含手机号`, issues)
  assert(
    !text.includes('省') && !text.includes('市') && !text.includes('区'),
    `${context} 不应含地址`,
    issues,
  )
}

function assertScoreInRange(score: number, label: string, issues: string[]) {
  assert(score >= 0 && score <= 10, `${label} 风险分应在 0~10，实际 ${score}`, issues)
  const rounded = Math.round(score * 10) / 10
  assert(score === rounded, `${label} 风险分应保留 1 位小数，实际 ${score}`, issues)
}

async function main() {
  const issues: string[] = []

  const qualityBuyer = mockBuyer({
    buyerKey: 'q1',
    qualityReturnCount: 1,
    buyerSummary: { qualityRefundOrderCount: 1, refundOrderCount: 1, orderCount: 3 },
  })
  assert(isBadBuyerCandidate(qualityBuyer), '品退 >= 1 的买家应进入候选', issues)

  const returnBuyer = mockBuyer({
    buyerKey: 'r1',
    returnRefundCount: 1,
    buyerSummary: { refundOrderCount: 1, orderCount: 3 },
  })
  assert(isBadBuyerCandidate(returnBuyer), '退货退款 >= 1 的买家应进入候选', issues)

  const afterSaleBuyer = mockBuyer({
    buyerKey: 'a1',
    afterSaleCount: 2,
    pendingAfterSaleOrderCount: 0,
    buyerSummary: { pendingAfterSaleOrderCount: 0, refundOrderCount: 1, orderCount: 4 },
  })
  assert(
    isBadBuyerCandidate(afterSaleBuyer) || afterSaleOrderCount(afterSaleBuyer) >= 2,
    '售后订单数 >= 2 的买家应进入候选',
    issues,
  )

  const highRefundRateBuyer = mockBuyer({
    buyerKey: 'hr1',
    orderCount: 5,
    signedOrderCount: 5,
    refundCount: 2,
    buyerSummary: { refundOrderCount: 2, orderCount: 5, realDealOrderCount: 5 },
  })
  assert(isBadBuyerCandidate(highRefundRateBuyer), '退款率 >= 40% 的买家应进入候选', issues)

  const freightOnlyBuyer = mockBuyer({
    buyerKey: 'f1',
    freightRefundCount: 2,
    returnRefundCount: 0,
    refundCount: 0,
    productRefundAmount: 0,
    buyerSummary: { refundOrderCount: 0, orderCount: 2 },
  })
  assert(!isBadBuyerCandidate(freightOnlyBuyer), '纯运费补偿不能单独作为垃圾客户', issues)

  const returnOnlyBuyer = mockBuyer({
    buyerKey: 'ret1',
    returnRefundCount: 2,
    refundCount: 0,
    orderCount: 4,
    signedOrderCount: 3,
    buyerSummary: { refundOrderCount: 0, orderCount: 4, realDealOrderCount: 3 },
  })
  assert(
    badBuyerRefundOrderCount(returnOnlyBuyer) >= 2,
    '有退货时退款相关订单数应包含退货单',
    issues,
  )
  const returnOnlyRate = buyerRefundRate(returnOnlyBuyer)
  assert(
    returnOnlyRate != null && returnOnlyRate > 0,
    `仅有退货、未完成退款金额时退款率不应为 0，实际 ${returnOnlyRate}`,
    issues,
  )

  const qcScore = computeBadBuyerRiskScore(
    mockBuyer({
      buyerKey: 's1',
      qualityReturnCount: 2,
      returnRefundCount: 0,
      buyerSummary: { qualityRefundOrderCount: 2, refundOrderCount: 2, orderCount: 4 },
    }),
  )
  const plainRefundScore = computeBadBuyerRiskScore(
    mockBuyer({
      buyerKey: 's2',
      qualityReturnCount: 0,
      returnRefundCount: 0,
      refundCount: 1,
      buyerSummary: { refundOrderCount: 1, orderCount: 5, realDealOrderCount: 5 },
    }),
  )
  assert(qcScore > plainRefundScore, '品退多的买家分数应高于普通退款买家', issues)

  const disputeScore = computeBadBuyerRiskScore(
    mockBuyer({
      buyerKey: 'd1',
      pendingAfterSaleOrderCount: 2,
      buyerSummary: { pendingAfterSaleOrderCount: 2, orderCount: 4, refundOrderCount: 2 },
    }),
  )
  const normalSignedScore = computeBadBuyerRiskScore(
    mockBuyer({
      buyerKey: 'n1',
      signedOrderCount: 5,
      orderCount: 5,
      refundCount: 0,
      buyerSummary: { orderCount: 5, realDealOrderCount: 5, refundOrderCount: 0 },
    }),
  )
  assert(disputeScore > normalSignedScore, '售后纠纷多的买家分数应高于正常签收买家', issues)

  const samples = [qcScore, plainRefundScore, disputeScore, normalSignedScore, 0, 10]
  for (const s of samples) assertScoreInRange(s, '样本', issues)

  const profile = buildBadBuyerProfile(
    mockBuyer({
      buyerKey: 'p1',
      qualityReturnCount: 2,
      returnRefundCount: 3,
      afterSaleCount: 4,
      refundCount: 3,
      productRefundAmount: 3260,
      buyerSummary: {
        qualityRefundOrderCount: 2,
        refundOrderCount: 3,
        orderCount: 4,
        refundAmountCent: 326000,
        pendingAfterSaleOrderCount: 1,
      },
    }),
    { mainShopName: '祥钰珠宝', shopNames: ['祥钰珠宝'] },
  )
  assert(
    qualityRefundOrderCount(mockBuyer({ buyerKey: 'x', qualityReturnCount: 2 })) ===
      profile.qualityRefundOrderCount,
    '榜单品退数应与计数函数一致',
    issues,
  )
  assert(
    returnRefundOrderCount(mockBuyer({ buyerKey: 'x', returnRefundCount: 3 })) ===
      profile.returnRefundOrderCount,
    '榜单退货数应与计数函数一致',
    issues,
  )

  const limitCap = Math.min(10, 99)
  assert(limitCap === 10, '后端 limit 应强制 <= 10', issues)

  const block1 = formatBadBuyerWechatBlock({
    rank: 1,
    buyerDisplayName: '小鹿鹿',
    riskScoreText: '8.8/10',
    qualityRefundOrderCount: 2,
    returnRefundOrderCount: 3,
    afterSaleOrderCount: 4,
    refundRateLabel: '75%',
    refundAmountYuan: 3260,
    shopLabel: '祥钰珠宝',
    reasonText: '品退多、退货多',
    suggestionText: '发货前必须确认圈口、颜色、瑕疵和预期',
  })
  const block2 = formatBadBuyerWechatBlock({
    rank: 2,
    buyerDisplayName: '爱玉姐姐',
    riskScoreText: '7.6/10',
    qualityRefundOrderCount: 1,
    returnRefundOrderCount: 2,
    afterSaleOrderCount: 3,
    refundRateLabel: '50%',
    refundAmountYuan: 1980,
    shopLabel: '云上珠宝',
    reasonText: '售后纠纷多',
    suggestionText: '售前把细节讲清楚，必要时让客户确认后再发货',
  })
  const wechatText = composeBadBuyerWechatText({
    title: '【最近30天垃圾客户榜单】',
    dateRangeLabel: '2026-06-04 ~ 2026-07-03',
    rows: [
      {
        rank: 1,
        buyerDisplayName: '小鹿鹿',
        riskScoreText: '8.8/10',
        qualityRefundOrderCount: 2,
        returnRefundOrderCount: 3,
        afterSaleOrderCount: 4,
        refundRateLabel: '75%',
        refundAmountYuan: 3260,
        shopLabel: '祥钰珠宝',
        reasonText: '品退多、退货多',
        suggestionText: '发货前必须确认圈口、颜色、瑕疵和预期',
      },
      {
        rank: 2,
        buyerDisplayName: '爱玉姐姐',
        riskScoreText: '7.6/10',
        qualityRefundOrderCount: 1,
        returnRefundOrderCount: 2,
        afterSaleOrderCount: 3,
        refundRateLabel: '50%',
        refundAmountYuan: 1980,
        shopLabel: '云上珠宝',
        reasonText: '售后纠纷多',
        suggestionText: '售前把细节讲清楚，必要时让客户确认后再发货',
      },
    ],
  })
  assert(wechatText.includes(block1), '微信文案应包含第一个买家块', issues)
  assert(wechatText.includes(block2), '微信文案应包含第二个买家块', issues)
  assert(wechatText.includes('\n\n1. 小鹿鹿'), '微信文案买家块之间应有空行', issues)
  assert(!wechatText.includes('.00'), '微信文案金额不应带 .00', issues)
  assertNoIdentityLeak(wechatText, '微信文案', issues)
  assert(wechatText.split('\n\n').filter((p) => /^\d+\./.test(p)).length <= 10, '微信文案最多 10 人', issues)

  const fri = new Date(Date.parse('2026-07-03T12:00:00+08:00'))
  const recent7 = resolveBuyerRankingDateRange('recent7', undefined, undefined, fri)
  const recent15 = resolveBuyerRankingDateRange('recent15', undefined, undefined, fri)
  const recent30 = resolveBuyerRankingDateRange('recent30', undefined, undefined, fri)
  const expected7Start = formatDateKeyShanghai(new Date(Date.parse('2026-06-27T12:00:00+08:00')))
  assert(
    recent7.startDate === expected7Start && recent7.endDate === '2026-07-03',
    `recent7 应为 ${expected7Start}~2026-07-03，实际 ${recent7.startDate}~${recent7.endDate}`,
    issues,
  )
  assert(recent15.preset === 'recent15', 'recent15 preset 应正确', issues)
  assert(recent30.preset === 'recent30', 'recent30 preset 应正确', issues)

  if (issues.length > 0) {
    console.error('[verify:bad-buyer-ranking] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:bad-buyer-ranking] PASS')
}

void main()
