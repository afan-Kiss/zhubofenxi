import type { BuyerRankingItem } from './buyer-ranking.service'
import { centToYuan } from '../utils/money'
import type { BuyerShopAggregate } from './buyer-shop-aggregate.service'
import { formatShopLabelForWechat } from './buyer-shop-aggregate.service'

export type BuyerMainTag =
  | '高价值'
  | '高客单'
  | '稳定签收'
  | '复购客户'
  | '售后关注'
  | '普通维护'

export const BUYER_MAIN_TAG_PRIORITY: BuyerMainTag[] = [
  '高价值',
  '高客单',
  '稳定签收',
  '复购客户',
  '售后关注',
  '普通维护',
]

export interface BuyerValueProfile {
  /** 0 ~ 10，保留 1 位小数 */
  customerValueScore: number
  scoreText: string
  scoreReason: string
  mainTag: BuyerMainTag
  allTags: BuyerMainTag[]
  averageOrderValueYuan: number
  refundRate: number | null
  qualityRefundRate: number | null
  mainShopName: string
  shopNames: string[]
  shopLabel: string
  suggestion: string
  realDealAmountYuan: number
  signedOrderCount: number
  completedOrderCount: number
  afterSaleOrderCount: number
  refundOrderCount: number
  qualityRefundOrderCount: number
  buyerStatusText: string
}

function realDealAmountYuan(item: BuyerRankingItem): number {
  if (item.buyerSummary?.displayEarnedAmountCent != null) {
    return centToYuan(item.buyerSummary.displayEarnedAmountCent)
  }
  if (item.buyerSummary?.realDealAmountCent != null) {
    return centToYuan(item.buyerSummary.realDealAmountCent)
  }
  return Number(item.earnedAmount ?? item.actualDealAmount ?? 0)
}

function realDealOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.realDealOrderCount ?? item.signedOrderCount ?? item.orderCount ?? 0
}

function signedOrderCount(item: BuyerRankingItem): number {
  return item.signedOrderCount ?? item.buyerSummary?.realDealOrderCount ?? 0
}

function completedOrderCount(item: BuyerRankingItem): number {
  return item.completedOrderCount ?? 0
}

function refundOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
}

function qualityOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
}

function afterSaleOrderCount(item: BuyerRankingItem): number {
  if (typeof item.afterSaleCount === 'number') return item.afterSaleCount
  const pending =
    item.buyerSummary?.pendingAfterSaleOrderCount ?? item.pendingAfterSaleOrderCount ?? 0
  const refund = refundOrderCount(item)
  const quality = qualityOrderCount(item)
  if (pending <= 0 && refund <= 0 && quality <= 0) return 0
  return Math.max(pending, refund, quality)
}

function refundRate(item: BuyerRankingItem): number | null {
  const orders = realDealOrderCount(item)
  if (orders <= 0) return null
  return refundOrderCount(item) / orders
}

function qualityRefundRate(item: BuyerRankingItem): number | null {
  const orders = realDealOrderCount(item)
  if (orders <= 0) return null
  return qualityOrderCount(item) / orders
}

function averageOrderValueYuan(item: BuyerRankingItem): number {
  const orders = realDealOrderCount(item)
  if (orders <= 0) return 0
  return realDealAmountYuan(item) / orders
}

function hasRealDeal(item: BuyerRankingItem): boolean {
  return realDealAmountYuan(item) > 0 || realDealOrderCount(item) > 0
}

function tagHighValue(item: BuyerRankingItem): boolean {
  const amount = realDealAmountYuan(item)
  const orders = realDealOrderCount(item)
  const rr = refundRate(item)
  const qc = qualityOrderCount(item)
  const aov = averageOrderValueYuan(item)
  if (rr == null) return false
  if (amount >= 3000 && rr < 0.2 && qc <= 1) return true
  if (signedOrderCount(item) >= 3 && rr < 0.2) return true
  if (aov >= 1000 && orders >= 2 && rr < 0.25) return true
  return false
}

function tagHighAov(item: BuyerRankingItem): boolean {
  const rr = refundRate(item)
  if (rr == null) return false
  return averageOrderValueYuan(item) >= 1000 && realDealOrderCount(item) >= 1 && rr < 0.3
}

function tagStableSigned(item: BuyerRankingItem): boolean {
  const rr = refundRate(item)
  if (rr == null) return false
  return signedOrderCount(item) >= 2 && rr <= 0.15 && qualityOrderCount(item) <= 1
}

function tagRepurchase(item: BuyerRankingItem): boolean {
  return realDealOrderCount(item) >= 2
}

function tagAfterSaleFocus(item: BuyerRankingItem): boolean {
  const rr = refundRate(item)
  return (
    refundOrderCount(item) >= 2 ||
    (rr != null && rr >= 0.4) ||
    qualityOrderCount(item) >= 2
  )
}

function tagNormalMaintain(item: BuyerRankingItem): boolean {
  return hasRealDeal(item)
}

function collectTags(item: BuyerRankingItem): BuyerMainTag[] {
  const tags: BuyerMainTag[] = []
  if (tagHighValue(item)) tags.push('高价值')
  if (tagHighAov(item)) tags.push('高客单')
  if (tagStableSigned(item)) tags.push('稳定签收')
  if (tagRepurchase(item)) tags.push('复购客户')
  if (tagAfterSaleFocus(item)) tags.push('售后关注')
  if (tags.length === 0 && tagNormalMaintain(item)) tags.push('普通维护')
  return tags
}

function pickMainTag(tags: BuyerMainTag[]): BuyerMainTag {
  for (const t of BUYER_MAIN_TAG_PRIORITY) {
    if (tags.includes(t)) return t
  }
  return '普通维护'
}

function suggestionForTag(tag: BuyerMainTag): string {
  switch (tag) {
    case '高价值':
    case '稳定签收':
    case '复购客户':
      return '重点维护'
    case '高客单':
      return '适合推荐高客单货'
    case '售后关注':
      return '发货前多确认'
    default:
      return '普通维护'
  }
}

function recentDealScoreDays(item: BuyerRankingItem): number {
  const last = item.lastOrderTime?.trim()
  if (!last || last === '—') return 0
  const ms = Date.parse(last.replace(' ', 'T') + (last.includes('+') ? '' : '+08:00'))
  if (!Number.isFinite(ms)) return 0
  const days = (Date.now() - ms) / 86_400_000
  if (days <= 7) return 1
  if (days <= 30) return 0.7
  if (days <= 90) return 0.4
  return 0
}

function lowAfterSaleBonus(rr: number): number {
  if (rr === 0) return 1
  if (rr < 0.1) return 0.8
  if (rr < 0.2) return 0.5
  return 0
}

function refundPenalty(rr: number): number {
  if (rr >= 0.5) return 2
  if (rr >= 0.3) return 1.2
  if (rr >= 0.2) return 0.6
  return 0
}

function qualityPenalty(qc: number): number {
  if (qc >= 3) return 2
  if (qc === 2) return 1.2
  if (qc === 1) return 0.5
  return 0
}

/** 买家价值分（满分 10，保留 1 位小数） */
export function computeValueScore(item: BuyerRankingItem): number {
  const amount = realDealAmountYuan(item)
  const orders = realDealOrderCount(item)
  const signed = signedOrderCount(item)
  const rr = refundRate(item) ?? 0
  const aov = averageOrderValueYuan(item)
  const qc = qualityOrderCount(item)

  let score = 0

  if (amount >= 10000) score += 3
  else if (amount >= 5000) score += 2.5
  else if (amount >= 3000) score += 2
  else if (amount >= 1000) score += 1
  else if (amount > 0) score += 0.5

  if (signed >= 5) score += 2
  else if (signed >= 3) score += 1.5
  else if (signed >= 1) score += 1

  if (orders >= 5) score += 1.5
  else if (orders >= 3) score += 1
  else if (orders >= 2) score += 0.5

  if (aov >= 2000) score += 1.5
  else if (aov >= 1000) score += 1
  else if (aov >= 500) score += 0.5

  score += recentDealScoreDays(item)
  score += lowAfterSaleBonus(rr)
  score -= refundPenalty(rr)
  score -= qualityPenalty(qc)

  score = Math.max(0, Math.min(10, score))
  return Math.round(score * 10) / 10
}

export function formatScoreText(score: number): string {
  return `${score.toFixed(1)}/10`
}

function buildScoreReason(score: number, item: BuyerRankingItem): string {
  const afterSale = afterSaleOrderCount(item)
  if (score >= 8.5) return '成交高、签收稳'
  if (score >= 7) return '值得重点维护'
  if (score >= 5) return '正常维护'
  if (score < 5 && afterSale > 0) return '发货前多确认'
  if (score < 5) return '继续观察'
  return '正常维护'
}

function buildBuyerStatusText(item: BuyerRankingItem): string {
  const signed = signedOrderCount(item)
  const completed = completedOrderCount(item)
  const afterSale = afterSaleOrderCount(item)
  if (afterSale > 0) return '有售后，发货前多确认'
  if (signed >= 2 && afterSale === 0) return '签收稳定'
  if (completed >= 2 && afterSale === 0) return '完成稳定'
  if (signed === 0 && completed === 0) return '本期暂无签收结果'
  return '正常维护'
}

export function buildBuyerValueProfile(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
): BuyerValueProfile {
  const allTags = collectTags(item)
  const mainTag = pickMainTag(allTags)
  const shopAgg = shop ?? { mainShopName: '未知店铺', shopNames: [] }
  const customerValueScore = computeValueScore(item)

  return {
    customerValueScore,
    scoreText: formatScoreText(customerValueScore),
    scoreReason: buildScoreReason(customerValueScore, item),
    mainTag,
    allTags,
    averageOrderValueYuan: averageOrderValueYuan(item),
    refundRate: refundRate(item),
    qualityRefundRate: qualityRefundRate(item),
    mainShopName: shopAgg.mainShopName,
    shopNames: shopAgg.shopNames,
    shopLabel: formatShopLabelForWechat(shopAgg),
    suggestion: suggestionForTag(mainTag),
    realDealAmountYuan: realDealAmountYuan(item),
    signedOrderCount: signedOrderCount(item),
    completedOrderCount: completedOrderCount(item),
    afterSaleOrderCount: afterSaleOrderCount(item),
    refundOrderCount: refundOrderCount(item),
    qualityRefundOrderCount: qualityOrderCount(item),
    buyerStatusText: buildBuyerStatusText(item),
  }
}

export function isHighValueTagBuyer(item: BuyerRankingItem): boolean {
  return tagHighValue(item)
}

export function isHighAovTagBuyer(item: BuyerRankingItem): boolean {
  return tagHighAov(item)
}

export function isStableSignedTagBuyer(item: BuyerRankingItem): boolean {
  return tagStableSigned(item)
}

export function isAfterSaleFocusTagBuyer(item: BuyerRankingItem): boolean {
  return tagAfterSaleFocus(item)
}

export function isRepurchaseTagBuyer(item: BuyerRankingItem): boolean {
  return tagRepurchase(item)
}
