/**
 * 微信群买家榜单文案验收
 * 用法: npm run verify:buyer-ranking-wechat-text
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  composeWechatWeeklyText,
  formatMoneyYuanCompact,
  formatWechatWeeklyBlock,
  type WechatWeeklyTextRow,
} from '../src/services/buyer-wechat-weekly-text.service'
import { buildBuyerValueProfile, isHighValueTagBuyer } from '../src/services/buyer-value-profile.service'
import { formatShopLabelForWechat } from '../src/services/buyer-shop-aggregate.service'
import type { BuyerRankingItem } from '../src/services/buyer-ranking.service'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

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
    completedOrderCount: partial.completedOrderCount ?? partial.signedOrderCount ?? 2,
    returnRefundCount: 0,
    refundOnlyCount: 0,
    freightRefundCount: 0,
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

function main() {
  const issues: string[] = []

  const rows: WechatWeeklyTextRow[] = [
    {
      rank: 1,
      buyerDisplayName: '小鹿鹿',
      amountYuan: 8260,
      scoreText: '9.2/10',
      signedOrderCount: 3,
      completedOrderCount: 2,
      afterSaleOrderCount: 0,
      mainTag: '高价值',
      shopLabel: '祥钰珠宝',
    },
    {
      rank: 2,
      buyerDisplayName: '爱玉姐姐',
      amountYuan: 5980,
      scoreText: '8.7/10',
      signedOrderCount: 2,
      completedOrderCount: 2,
      afterSaleOrderCount: 0,
      mainTag: '高客单',
      shopLabel: '云上珠宝',
    },
  ]

  assert(!('buyerShortCode' in rows[0]!), 'WechatWeeklyTextRow 不应含 buyerShortCode 字段', issues)

  const text = composeWechatWeeklyText({
    title: '【本周高价值买家榜】',
    dateRangeLabel: '2026-06-29 ~ 2026-07-05',
    rows,
  })

  const blocks = text.split('\n\n').filter((b) => b.startsWith('1.') || b.startsWith('2.'))
  assert(blocks.length === 2, `每个买家一块，应有 2 块，实际 ${blocks.length}`, issues)

  assert(text.includes('\n\n1. 小鹿鹿'), '买家块之间应空一行', issues)
  assert(text.includes('价值分：9.2/10'), '应含价值分格式', issues)
  assert(text.includes('签收：3 单'), '应含签收单数', issues)
  assert(text.includes('完成：2 单'), '应含完成单数', issues)
  assert(text.includes('售后：0 单'), '应含售后单数', issues)
  assert(text.includes('标签：高价值'), '应含标签', issues)
  assert(text.includes('店铺：祥钰珠宝'), '应含店铺', issues)

  assert(!text.includes('.00'), '金额不应带 .00', issues)
  assert(formatMoneyYuanCompact(8260) === '¥8,260', `紧凑金额格式错误: ${formatMoneyYuanCompact(8260)}`, issues)

  assertNoIdentityLeak(text, '微信群文案', issues)

  for (const block of blocks) {
    assert(block.includes('消费：'), `块应含消费: ${block.slice(0, 40)}`, issues)
    assert(block.includes('价值分：'), `块应含价值分: ${block.slice(0, 40)}`, issues)
    assert(block.includes('签收：'), `块应含签收: ${block.slice(0, 40)}`, issues)
    assert(block.includes('完成：'), `块应含完成: ${block.slice(0, 40)}`, issues)
    assert(block.includes('售后：'), `块应含售后: ${block.slice(0, 40)}`, issues)
    assert(block.includes('标签：'), `块应含标签: ${block.slice(0, 40)}`, issues)
    assert(block.includes('店铺：'), `块应含店铺: ${block.slice(0, 40)}`, issues)
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
    actualDealAmount: 8000,
    earnedAmount: 8000,
    signedAmount: 8000,
    gmv: 8000,
    signedOrderCount: 4,
    completedOrderCount: 4,
    orderCount: 4,
    refundCount: 0,
    lastOrderTime: '2026-07-03 12:00:00',
    buyerSummary: {
      realDealAmountCent: 800000,
      displayEarnedAmountCent: 800000,
      realDealOrderCount: 4,
      refundOrderCount: 0,
      qualityRefundOrderCount: 0,
      returnRefundOrderCount: 0,
      afterSaleOrderCount: 0,
      orderCount: 4,
      paidOrderCount: 4,
      payAmountCent: 800000,
      refundAmountCent: 0,
      receivableAmountCent: 800000,
      netDealAmountCent: 800000,
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

  const sampleBlock = formatWechatWeeklyBlock(rows[0]!)
  assert(sampleBlock.startsWith('1. 小鹿鹿'), `块格式不正确: ${sampleBlock}`, issues)
  assert(!sampleBlock.includes('#'), '块内不应含 # 识别码', issues)

  const buyerRankingTabSrc = readFileSync(
    join(REPO_ROOT, 'apps/web/src/pages/board/BuyerRankingTab.tsx'),
    'utf8',
  )
  assert(
    !buyerRankingTabSrc.includes('buyerShortCode') &&
      !buyerRankingTabSrc.includes('buyerIdentityCode') &&
      !buyerRankingTabSrc.includes('#{shortCode}'),
    'BuyerRankingTab 卡片不应展示识别码相关字段',
    issues,
  )

  const buyerOrderDrawerSrc = readFileSync(
    join(REPO_ROOT, 'apps/web/src/components/board/BuyerOrderDrawer.tsx'),
    'utf8',
  )
  assert(
    !buyerOrderDrawerSrc.includes('买家识别码'),
    'BuyerOrderDrawer 不应展示「买家识别码」',
    issues,
  )

  if (issues.length > 0) {
    console.error('[verify:buyer-ranking-wechat-text] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:buyer-ranking-wechat-text] PASS')
}

main()
