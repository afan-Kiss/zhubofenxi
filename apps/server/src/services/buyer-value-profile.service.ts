import type { BuyerRankingItem } from './buyer-ranking.service'
import { centToYuan } from '../utils/money'
import type { BuyerShopAggregate } from './buyer-shop-aggregate.service'
import { formatShopLabelForWechat } from './buyer-shop-aggregate.service'
import {
  capBuyerValueRate,
  computeHighValueScoreFromItem,
  extractBuyerValueCustomerMetrics,
  isTrueHighValueCustomer,
} from './buyer-value-ranking.service'

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
  scoreText: string
  scoreReason: string
  mainTag: BuyerMainTag
  allTags: BuyerMainTag[]
  averageOrderValueYuan: number
  refundRate: number | null
  qualityRefundRate: number | null
  signedRate: number | null
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
  paidOrderCount: number
  buyerStatusText: string
}

function metricsFromItem(item: BuyerRankingItem, shop?: BuyerShopAggregate) {
  return extractBuyerValueCustomerMetrics(item, shop)
}

function realDealAmountYuan(item: BuyerRankingItem): number {
  const m = metricsFromItem(item)
  return centToYuan(m.validAmountCent)
}

function realDealOrderCount(item: BuyerRankingItem): number {
  return metricsFromItem(item).validOrderCount
}

function signedOrderCount(item: BuyerRankingItem): number {
  return metricsFromItem(item).signedOrderCount ?? 0
}

function completedOrderCount(item: BuyerRankingItem): number {
  return item.completedOrderCount ?? 0
}

function refundOrderCount(item: BuyerRankingItem): number {
  return metricsFromItem(item).refundOrderCount
}

function qualityOrderCount(item: BuyerRankingItem): number {
  return metricsFromItem(item).qualityRefundCount
}

function afterSaleOrderCount(item: BuyerRankingItem): number {
  return metricsFromItem(item).aftersaleCount
}

function refundRate(item: BuyerRankingItem): number | null {
  const m = metricsFromItem(item)
  if (m.paidOrderCount <= 0) return null
  return m.refundRate
}

function qualityRefundRate(item: BuyerRankingItem): number | null {
  const m = metricsFromItem(item)
  if (m.paidOrderCount <= 0) return null
  return capBuyerValueRate(m.qualityRefundCount, m.paidOrderCount)
}

function signedRate(item: BuyerRankingItem): number | null {
  return metricsFromItem(item).signedRate
}

function averageOrderValueYuan(item: BuyerRankingItem): number {
  const m = metricsFromItem(item)
  if (m.validOrderCount <= 0) return 0
  return centToYuan(m.avgValidAmountCent)
}

function hasRealDeal(item: BuyerRankingItem): boolean {
  const m = metricsFromItem(item)
  return m.validAmountCent > 0 || m.validOrderCount > 0
}

function tagHighValue(item: BuyerRankingItem, shop?: BuyerShopAggregate): boolean {
  return isTrueHighValueCustomer(item, shop)
}

function tagHighAov(item: BuyerRankingItem): boolean {
  const m = metricsFromItem(item)
  return centToYuan(m.avgValidAmountCent) >= 1000 && m.validOrderCount >= 1 && m.refundRate < 0.3
}

function tagStableSigned(item: BuyerRankingItem): boolean {
  const m = metricsFromItem(item)
  return (m.signedOrderCount ?? 0) >= 2 && m.refundRate <= 0.15 && m.qualityRefundCount <= 1
}

function tagRepurchase(item: BuyerRankingItem): boolean {
  return realDealOrderCount(item) >= 2
}

function tagAfterSaleFocus(item: BuyerRankingItem): boolean {
  const m = metricsFromItem(item)
  return m.refundOrderCount >= 2 || m.refundRate >= 0.4 || m.qualityRefundCount >= 2
}

function tagNormalMaintain(item: BuyerRankingItem): boolean {
  return hasRealDeal(item)
}

function collectTags(item: BuyerRankingItem, shop?: BuyerShopAggregate): BuyerMainTag[] {
  const tags: BuyerMainTag[] = []
  if (tagHighValue(item, shop)) tags.push('高价值')
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

export function computeValueScore(item: BuyerRankingItem, shop?: BuyerShopAggregate): number {
  return computeHighValueScoreFromItem(item, shop)
}

export function formatScoreText(score: number): string {
  return `${score.toFixed(1)}/10`
}

function buildScoreReason(score: number, item: BuyerRankingItem): string {
  const m = metricsFromItem(item)
  if (score >= 8.5 && m.refundOrderCount === 0) return '签收稳、无售后退款'
  if (score >= 7) return '值得重点维护'
  if (score >= 5) return '正常维护'
  if (m.refundRate >= 0.3) return '退款占比偏高，发货前多确认'
  if (m.pendingAftersaleCount > 0) return '有售后处理中，发货前多确认'
  return '继续观察'
}

function buildBuyerStatusText(item: BuyerRankingItem): string {
  const m = metricsFromItem(item)
  if (m.pendingAftersaleCount > 0) return '有售后处理中，发货前多确认'
  if ((m.signedOrderCount ?? 0) >= 2 && m.refundOrderCount === 0) return '签收稳定'
  if (m.signedOrderCount == null) return '暂无签收追踪数据'
  if ((m.signedOrderCount ?? 0) === 0) return '本期暂无签收结果'
  return '正常维护'
}

export function buildBuyerValueProfile(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
): BuyerValueProfile {
  const allTags = collectTags(item, shop)
  const mainTag = pickMainTag(allTags)
  const shopAgg = shop ?? { mainShopName: '未知店铺', shopNames: [] }
  const customerValueScore = computeValueScore(item, shopAgg)
  const m = metricsFromItem(item, shopAgg)

  return {
    customerValueScore,
    scoreText: formatScoreText(customerValueScore),
    scoreReason: buildScoreReason(customerValueScore, item),
    mainTag,
    allTags,
    averageOrderValueYuan: averageOrderValueYuan(item),
    refundRate: refundRate(item),
    qualityRefundRate: qualityRefundRate(item),
    signedRate: signedRate(item),
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
    paidOrderCount: m.paidOrderCount,
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
