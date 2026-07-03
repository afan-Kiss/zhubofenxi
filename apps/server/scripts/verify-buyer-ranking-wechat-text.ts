/**
 * 微信群买家榜单文案验收
 * 用法: npm run verify:buyer-ranking-wechat-text
 */
import {
  composeWechatWeeklyText,
  formatWechatWeeklyLine,
  type WechatWeeklyTextRow,
} from '../src/services/buyer-wechat-weekly-text.service'
import { buildBuyerValueProfile, isHighValueTagBuyer } from '../src/services/buyer-value-profile.service'
import { formatShopLabelForWechat } from '../src/services/buyer-shop-aggregate.service'
import type { BuyerRankingItem } from '../src/services/buyer-ranking.service'

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
    orderCount: partial.orderCount ?? 3,
    signedOrderCount: partial.signedOrderCount ?? 2,
    unsignedOrderCount: 0,
    completedOrderCount: partial.signedOrderCount ?? 2,
    returnRefundCount: 0,
    refundOnlyCount: 0,
    freightRefundCount: 0,
    afterSaleClosedNoRefundCount: 0,
    gmv: partial.gmv ?? 5000,
    signedAmount: partial.signedAmount ?? 5000,
    productRefundAmount: partial.productRefundAmount ?? 0,
    freightRefundAmount: 0,
    actualDealAmount: partial.actualDealAmount ?? 5000,
    earnedAmount: partial.earnedAmount ?? 5000,
    qualityReturnCount: partial.qualityReturnCount ?? 0,
    refundCount: partial.refundCount ?? 0,
    buyerSummary: partial.buyerSummary,
    lastOrderTime: partial.lastOrderTime ?? '2026-07-01 12:00:00',
  }
}

function main() {
  const issues: string[] = []

  const rows: WechatWeeklyTextRow[] = [
    {
      rank: 1,
      buyerDisplayName: '小鹿鹿',
      buyerShortCode: 'A1B2C3',
      amountYuan: 8260,
      signedOrderCount: 3,
      refundOrderCount: 0,
      mainTag: '高价值',
      shopLabel: '祥钰珠宝',
    },
    {
      rank: 2,
      buyerDisplayName: '爱玉姐姐',
      buyerShortCode: 'D4E5F6',
      amountYuan: 5980,
      signedOrderCount: 2,
      refundOrderCount: 0,
      mainTag: '高价值',
      shopLabel: '云上珠宝',
    },
  ]

  const text = composeWechatWeeklyText({
    title: '【本周高价值买家榜】',
    dateRangeLabel: '2026-06-29 ~ 2026-07-05',
    rows,
  })

  const lines = text.split('\n').filter((l) => /^\d+\./.test(l))
  assert(lines.length === 2, `应按 1、2 换行排列，实际 ${lines.length} 行`, issues)

  for (const line of lines) {
    assert(line.includes('｜消费 ¥'), `行应含消费金额: ${line}`, issues)
    assert(line.includes('签收'), `行应含签收: ${line}`, issues)
    assert(line.includes('退货'), `行应含退货: ${line}`, issues)
    assert(line.includes('高价值') || line.includes('普通维护') || line.includes('高客单'), `行应含标签: ${line}`, issues)
    assert(line.includes('珠宝'), `行应含店铺: ${line}`, issues)
    assert(!line.includes('buyerKey'), `不应含完整 buyerId: ${line}`, issues)
    assert(!/1[3-9]\d{9}/.test(line), `不应含手机号: ${line}`, issues)
    assert(!line.includes('省') && !line.includes('市') && !line.includes('区'), `不应含地址: ${line}`, issues)
  }

  const multiShop = formatShopLabelForWechat({
    mainShopName: '祥钰珠宝',
    shopNames: ['祥钰珠宝', '云上珠宝'],
  })
  assert(multiShop === '祥钰珠宝等2店', `多店文案应为 祥钰珠宝等2店，实际 ${multiShop}`, issues)

  const highValueBuyer = mockBuyer({
    buyerKey: 'id:highvalue001',
    buyerId: 'id:highvalue001',
    nickname: '高价值测试',
    actualDealAmount: 3500,
    earnedAmount: 3500,
    signedOrderCount: 3,
    orderCount: 3,
    refundCount: 0,
    buyerSummary: {
      realDealAmountCent: 350000,
      displayEarnedAmountCent: 350000,
      realDealOrderCount: 3,
      refundOrderCount: 0,
      qualityRefundOrderCount: 0,
      orderCount: 3,
      paidOrderCount: 3,
      payAmountCent: 350000,
      refundAmountCent: 0,
      receivableAmountCent: 350000,
      netDealAmountCent: 350000,
      pendingAfterSaleOrderCount: 0,
    },
  })
  assert(isHighValueTagBuyer(highValueBuyer), '高价值买家应满足标签规则', issues)
  assert(buildBuyerValueProfile(highValueBuyer).mainTag === '高价值', '主标签应为高价值', issues)

  const emptyText = composeWechatWeeklyText({
    title: '【本周高价值买家榜】',
    dateRangeLabel: '2026-06-29 ~ 2026-07-05',
    rows: [],
  })
  assert(emptyText.includes('本期暂时没有符合条件的客户'), '空数据应返回友好文案', issues)

  const limited = rows.slice(0, 1)
  assert(limited.length === 1, 'limit 应生效（单测 slice）', issues)

  const sampleLine = formatWechatWeeklyLine(rows[0]!)
  assert(sampleLine.startsWith('1. 小鹿鹿'), `行格式不正确: ${sampleLine}`, issues)

  if (issues.length > 0) {
    console.error('[verify:buyer-ranking-wechat-text] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:buyer-ranking-wechat-text] PASS')
}

main()
