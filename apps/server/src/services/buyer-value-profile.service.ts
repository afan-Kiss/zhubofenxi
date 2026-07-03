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
  customerValueScore: number
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
  refundOrderCount: number
  qualityRefundOrderCount: number
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

function refundOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
}

function qualityOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
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

function computeValueScore(item: BuyerRankingItem): number {
  const amount = realDealAmountYuan(item)
  const orders = realDealOrderCount(item)
  const signed = signedOrderCount(item)
  const rr = refundRate(item) ?? 0
  const qr = qualityRefundRate(item) ?? 0
  const aov = averageOrderValueYuan(item)

  let score = 0
  score += Math.min(40, (amount / 10000) * 40)
  score += Math.min(25, signed >= 2 ? 15 + Math.min(10, signed * 2) : signed * 5)
  score += Math.min(15, orders >= 2 ? 10 + Math.min(5, orders) : orders > 0 ? 3 : 0)
  score += Math.min(10, aov >= 1000 ? 10 : aov >= 500 ? 6 : aov > 0 ? 3 : 0)

  const last = item.lastOrderTime?.trim()
  if (last && last !== '—') {
    const ms = Date.parse(last.replace(' ', 'T') + (last.includes('+') ? '' : '+08:00'))
    if (Number.isFinite(ms)) {
      const days = (Date.now() - ms) / 86_400_000
      if (days <= 7) score += 10
      else if (days <= 30) score += 7
      else if (days <= 90) score += 4
    }
  }

  score -= Math.min(30, rr * 60)
  score -= Math.min(30, qr * 80)
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function buildBuyerValueProfile(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
): BuyerValueProfile {
  const allTags = collectTags(item)
  const mainTag = pickMainTag(allTags)
  const shopAgg = shop ?? { mainShopName: '未知店铺', shopNames: [] }

  return {
    customerValueScore: computeValueScore(item),
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
    refundOrderCount: refundOrderCount(item),
    qualityRefundOrderCount: qualityOrderCount(item),
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
