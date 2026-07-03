/**
 * 高风险售后客户提醒验收
 * 用法: npm run verify:bad-buyer-ranking
 */
import {
  afterSaleOrderCount,
  badBuyerRefundOrderCount,
  buildBadBuyerProfile,
  buyerRefundRate,
  capBadBuyerRate,
  capBadBuyerCount,
  compareBadBuyerRankingItems,
  composeBadBuyerWechatText,
  computeBadBuyerRiskScore,
  computeBadBuyerRiskScoreFromStats,
  extractBadBuyerCustomerStats,
  formatBadBuyerListDisplayName,
  formatBadBuyerRefundRateLabel,
  formatBadBuyerSignedRateLabel,
  formatBadBuyerWechatBlock,
  isBadBuyerCandidate,
  qualityRefundOrderCount,
  returnRefundOrderCount,
  BAD_BUYER_LIST_TITLE_SUFFIX,
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
    unsignedOrderCount: partial.unsignedOrderCount ?? 0,
    completedOrderCount: partial.completedOrderCount ?? 0,
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

  // 【1】paid=1, aftersale=3, refund_orders=1 => 退款率 100% 不是 300%
  const case1 = mockBuyer({
    buyerKey: 'case1',
    orderCount: 1,
    paidOrderCount: 1,
    signedOrderCount: 1,
    unsignedOrderCount: 0,
    afterSaleCount: 3,
    buyerSummary: {
      orderCount: 1,
      paidOrderCount: 1,
      realDealOrderCount: 1,
      refundOrderCount: 1,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 100000,
      payAmountCent: 100000,
      refundAmountCent: 100000,
      freightRefundAmountCent: 0,
      netDealAmountCent: 0,
      realDealAmountCent: 0,
      displayEarnedAmountCent: 0,
    },
  })
  const case1Stats = extractBadBuyerCustomerStats(case1, undefined, { aftersaleApplyCount: 3 })
  assert(case1Stats.refundOrderCount === 1, 'case1 refundOrderCount 应为 1', issues)
  assert(case1Stats.aftersaleCount === 3, 'case1 aftersaleCount 应为 3', issues)
  const case1Rate = capBadBuyerRate(case1Stats.refundOrderCount, case1Stats.paidCount)
  assert(case1Rate === 1, `case1 退款率应为 100%，实际 ${case1Rate}`, issues)
  assert(
    formatBadBuyerRefundRateLabel(case1Rate) === '100%',
    'case1 退款率展示应为 100%',
    issues,
  )
  assert(
    buyerRefundRate(case1) === 1,
    `buyerRefundRate case1 应为 1，实际 ${buyerRefundRate(case1)}`,
    issues,
  )

  // 【2】paid=2, refund_orders=8 => 封顶 100%
  const case2Stats = extractBadBuyerCustomerStats(
    mockBuyer({
      buyerKey: 'case2',
      orderCount: 2,
      paidOrderCount: 2,
      signedOrderCount: 2,
      buyerSummary: {
        orderCount: 2,
        paidOrderCount: 2,
        realDealOrderCount: 2,
        refundOrderCount: 8,
        qualityRefundOrderCount: 0,
        pendingAfterSaleOrderCount: 0,
        receivableAmountCent: 200000,
        payAmountCent: 200000,
        refundAmountCent: 150000,
        freightRefundAmountCent: 0,
        netDealAmountCent: 50000,
        realDealAmountCent: 50000,
        displayEarnedAmountCent: 50000,
      },
    }),
  )
  assert(case2Stats.refundOrderCount === 2, 'case2 refundOrderCount 应封顶为 2', issues)
  assert(
    capBadBuyerRate(case2Stats.refundOrderCount, case2Stats.paidCount) === 1,
    'case2 退款率应封顶 100%',
    issues,
  )

  // 【3】signed 80%
  assert(
    formatBadBuyerSignedRateLabel(8, 10) === '80%',
    '签收率 8/10 应显示 80%',
    issues,
  )

  // 【4】无签收字段 => 签收率 —
  const case4 = mockBuyer({
    buyerKey: 'case4',
    orderCount: 2,
    signedOrderCount: 0,
    unsignedOrderCount: 0,
    completedOrderCount: 0,
    buyerSummary: {
      orderCount: 2,
      paidOrderCount: 2,
      realDealOrderCount: 2,
      refundOrderCount: 0,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 200000,
      payAmountCent: 200000,
      refundAmountCent: 0,
      freightRefundAmountCent: 0,
      netDealAmountCent: 200000,
      realDealAmountCent: 200000,
      displayEarnedAmountCent: 200000,
    },
  })
  const case4Stats = extractBadBuyerCustomerStats(case4)
  assert(case4Stats.signedCount == null, '无签收追踪数据时 signedCount 应为 null', issues)
  assert(
    formatBadBuyerSignedRateLabel(case4Stats.signedCount, case4Stats.paidCount) === '—',
    '无签收数据时签收率应显示 —',
    issues,
  )

  // 【5】一订单多次售后：refund 去重，aftersale 累计
  assert(
    capBadBuyerCount(1, 1) === 1 && extractBadBuyerCustomerStats(case1, undefined, { aftersaleApplyCount: 3 }).aftersaleCount === 3,
    '多次售后申请应累计 aftersaleCount',
    issues,
  )

  // 【6】risk_score 封顶 10
  const extremeScore = computeBadBuyerRiskScoreFromStats({
    paidCount: 1,
    paidAmountCent: 100000,
    signedCount: 0,
    signedAmountCent: 0,
    refundOrderCount: 1,
    refundAmountCent: 100000,
    qualityRefundCount: 1,
    returnRefundCount: 1,
    aftersaleCount: 5,
    unsignedCount: 1,
    shopCount: 3,
    hasSignedData: true,
  })
  assert(extremeScore <= 10, `极端样本 risk_score 应 <=10，实际 ${extremeScore}`, issues)

  const qualityBuyer = mockBuyer({
    buyerKey: 'q1',
    qualityReturnCount: 1,
    buyerSummary: {
      qualityRefundOrderCount: 1,
      refundOrderCount: 1,
      orderCount: 3,
      paidOrderCount: 3,
      realDealOrderCount: 3,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 300000,
      payAmountCent: 300000,
      refundAmountCent: 100000,
      freightRefundAmountCent: 0,
      netDealAmountCent: 200000,
      realDealAmountCent: 200000,
      displayEarnedAmountCent: 200000,
    },
  })
  assert(isBadBuyerCandidate(qualityBuyer), '品退 >= 1 的买家应进入候选', issues)

  const freightOnlyBuyer = mockBuyer({
    buyerKey: 'f1',
    freightRefundCount: 2,
    returnRefundCount: 0,
    refundCount: 0,
    productRefundAmount: 0,
    buyerSummary: {
      refundOrderCount: 0,
      orderCount: 2,
      paidOrderCount: 2,
      realDealOrderCount: 2,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 200000,
      payAmountCent: 200000,
      refundAmountCent: 0,
      freightRefundAmountCent: 2000,
      netDealAmountCent: 200000,
      realDealAmountCent: 200000,
      displayEarnedAmountCent: 200000,
    },
  })
  assert(!isBadBuyerCandidate(freightOnlyBuyer), '纯运费补偿不能单独作为高风险客户', issues)

  const returnOnlyBuyer = mockBuyer({
    buyerKey: 'ret1',
    returnRefundCount: 2,
    refundCount: 0,
    orderCount: 4,
    signedOrderCount: 3,
    unsignedOrderCount: 1,
    buyerSummary: {
      refundOrderCount: 0,
      orderCount: 4,
      paidOrderCount: 4,
      realDealOrderCount: 3,
      qualityRefundOrderCount: 0,
      pendingAfterSaleOrderCount: 0,
      receivableAmountCent: 400000,
      payAmountCent: 400000,
      refundAmountCent: 0,
      freightRefundAmountCent: 0,
      netDealAmountCent: 400000,
      realDealAmountCent: 300000,
      displayEarnedAmountCent: 300000,
    },
  })
  assert(
    badBuyerRefundOrderCount(returnOnlyBuyer) <= 4,
    '退款订单数不应超过支付订单数',
    issues,
  )

  const profile = buildBadBuyerProfile(
    mockBuyer({
      buyerKey: 'p1',
      qualityReturnCount: 2,
      returnRefundCount: 3,
      afterSaleCount: 4,
      refundCount: 3,
      signedOrderCount: 4,
      unsignedOrderCount: 0,
      productRefundAmount: 3260,
      buyerSummary: {
        qualityRefundOrderCount: 2,
        refundOrderCount: 3,
        orderCount: 4,
        paidOrderCount: 4,
        realDealOrderCount: 4,
        refundAmountCent: 326000,
        pendingAfterSaleOrderCount: 1,
        receivableAmountCent: 400000,
        payAmountCent: 400000,
        freightRefundAmountCent: 0,
        netDealAmountCent: 74000,
        realDealAmountCent: 74000,
        displayEarnedAmountCent: 74000,
      },
    }),
    { mainShopName: '祥钰珠宝', shopNames: ['祥钰珠宝'] },
    { aftersaleApplyCount: 6 },
  )
  assert(profile.riskLevel.length > 0, 'profile 应含 riskLevel', issues)
  assert(profile.paidCount === 4, 'profile paidCount 应正确', issues)
  assert(!profile.reasonText.includes('售后纠纷多'), '原因不应再使用「售后纠纷多」', issues)

  const block1 = formatBadBuyerWechatBlock({
    rank: 1,
    buyerDisplayName: '小鹿鹿',
    riskLevel: '重点确认',
    riskScoreText: '8.8/10',
    paidCount: 4,
    signedLine: '3 单',
    signedRateLabel: '75%',
    refundOrderCount: 3,
    refundRateLabel: '75%',
    refundAmountYuan: 3260,
    qualityRefundOrderCount: 2,
    returnRefundOrderCount: 3,
    aftersaleCount: 6,
    shopLabel: '祥钰珠宝',
    reasonText: '品退比例偏高、售后申请次数偏多',
    suggestionText: '发货前重点确认成色、瑕疵、纹裂、色差、实拍图和证书信息；售前把细节讲清楚，尽量用实拍图/视频确认，减少反复售后',
  })
  const wechatText = composeBadBuyerWechatText({
    title: `【最近30天${BAD_BUYER_LIST_TITLE_SUFFIX}】`,
    dateRangeLabel: '2026-06-04 ~ 2026-07-03',
    rows: [
      {
        rank: 1,
        buyerDisplayName: '小鹿鹿',
        riskLevel: '重点确认',
        riskScoreText: '8.8/10',
        paidCount: 4,
        signedLine: '3 单',
        signedRateLabel: '75%',
        refundOrderCount: 3,
        refundRateLabel: '75%',
        refundAmountYuan: 3260,
        qualityRefundOrderCount: 2,
        returnRefundOrderCount: 3,
        aftersaleCount: 6,
        shopLabel: '祥钰珠宝',
        reasonText: '品退比例偏高、售后申请次数偏多',
        suggestionText: '发货前重点确认成色、瑕疵、纹裂、色差、实拍图和证书信息；售前把细节讲清楚，尽量用实拍图/视频确认，减少反复售后',
      },
    ],
  })
  assert(wechatText.includes(block1), '微信文案应包含第一个买家块', issues)
  assert(!wechatText.includes('垃圾客户'), '微信文案不应含「垃圾客户」', issues)
  assert(!wechatText.includes('垃圾风险分'), '微信文案不应含「垃圾风险分」', issues)
  assert(!wechatText.includes('风险等级：'), '微信文案不应含风险等级', issues)
  assert(!wechatText.includes('谨慎发货'), '微信文案不应含「谨慎发货」', issues)
  assert(wechatText.includes('【小鹿鹿】'), '品退买家名称应用【】框起', issues)
  assert(
    formatBadBuyerListDisplayName('己悦', 0) === '己悦',
    '无品退时不应加【】',
    issues,
  )
  assert(
    formatBadBuyerListDisplayName('小鹿鹿', 2) === '【小鹿鹿】',
    '有品退时应加【】',
    issues,
  )
  assert(wechatText.includes('售后申请：'), '微信文案应含售后申请次数字段', issues)
  const sortSample = [
    { badBuyerProfile: { qualityRefundOrderCount: 0, riskScore: 9, refundOrderCount: 3 } },
    { badBuyerProfile: { qualityRefundOrderCount: 2, riskScore: 5, refundOrderCount: 2 } },
    { badBuyerProfile: { qualityRefundOrderCount: 2, riskScore: 8, refundOrderCount: 1 } },
  ].sort(compareBadBuyerRankingItems)
  assert(
    sortSample[0].badBuyerProfile.qualityRefundOrderCount === 2 &&
      sortSample[0].badBuyerProfile.riskScore === 8,
    '排序应品退单数优先，同品退再按风险分',
    issues,
  )
  assertNoIdentityLeak(wechatText, '微信文案', issues)

  const fri = new Date(Date.parse('2026-07-03T12:00:00+08:00'))
  const recent30 = resolveBuyerRankingDateRange('recent30', undefined, undefined, fri)
  assert(recent30.preset === 'recent30', 'recent30 preset 应正确', issues)

  const samples = [computeBadBuyerRiskScore(qualityBuyer), extremeScore, 0, 10]
  for (const s of samples) assertScoreInRange(s, '样本', issues)

  if (issues.length > 0) {
    console.error('[verify:bad-buyer-ranking] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:bad-buyer-ranking] PASS')
}

void main()
