import type { BuyerRankingItem } from './buyer-ranking.service'
import { isHighValueBuyer, isRepurchaseBuyer } from './buyer-ranking-classification'
import { centToYuan } from '../utils/money'

function standardizedRefundOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
}

function standardizedRefundAmountYuan(item: BuyerRankingItem): number {
  if (item.buyerSummary) return centToYuan(item.buyerSummary.refundAmountCent)
  return Number(item.productRefundAmount ?? item.refundAmount ?? 0)
}

function standardizedQualityOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
}

/** 成功退款订单数（refundAmountCent > 0） */
export function buyerRefundSuccessCount(item: BuyerRankingItem): number {
  return standardizedRefundOrderCount(item)
}

/** @deprecated 调试字段，页面主统计勿用 */
export function buyerAfterSaleOrderCount(item: BuyerRankingItem): number {
  return item.afterSaleCount ?? item.refundRelatedOrderCount ?? 0
}

/** @deprecated 使用 buyerAfterSaleOrderCount */
export function buyerRefundRelatedOrderCount(item: BuyerRankingItem): number {
  return buyerAfterSaleOrderCount(item)
}

export function buyerRefundAmount(item: BuyerRankingItem): number {
  return standardizedRefundAmountYuan(item)
}

/** 退款排行 / 退款客户数（不含纯运费退） */
export function isRefundRankingBuyer(item: BuyerRankingItem): boolean {
  const productRefund = standardizedRefundAmountYuan(item)
  const refundOrders = standardizedRefundOrderCount(item)
  const freightOnly =
    (item.freightRefundAmount ?? 0) > 0 &&
    productRefund <= 0 &&
    refundOrders <= 0
  if (freightOnly) return false
  return productRefund > 0 || refundOrders > 0
}

/** 品退排行 / 品退客户数（官方品退命中） */
export function isQualityRankingBuyer(item: BuyerRankingItem): boolean {
  return standardizedQualityOrderCount(item) > 0
}

/** 黑名单排行 / 黑名单客户数 */
export function isBlacklistRankingBuyer(item: BuyerRankingItem): boolean {
  return item.isBlacklisted === true
}

/** 消费排行：真实成交金额 realDealAmountCent > 0 */
export function isSpendRankingBuyer(item: BuyerRankingItem): boolean {
  const realDeal =
    item.buyerSummary?.realDealAmountCent != null
      ? item.buyerSummary.realDealAmountCent / 100
      : item.buyerSummary?.netDealAmountCent != null
        ? item.buyerSummary.netDealAmountCent / 100
        : item.actualDealAmount
  return realDeal > 0
}

export function filterBuyerRankingByTab(
  items: BuyerRankingItem[],
  tab?: string,
): BuyerRankingItem[] {
  switch (tab) {
    case 'repurchase':
      return items.filter((i) => isRepurchaseBuyer(i))
    case 'refund':
      return items.filter((i) => isRefundRankingBuyer(i))
    case 'quality':
      return items.filter((i) => isQualityRankingBuyer(i))
    case 'blacklist':
      return items.filter((i) => isBlacklistRankingBuyer(i))
    case 'spend':
    default:
      return items.filter((i) => isSpendRankingBuyer(i))
  }
}

export function buildBuyerRankingTabSummary(items: BuyerRankingItem[]): {
  highValueCount: number
  repurchaseCount: number
  refundCount: number
  qualityHeavyCount: number
  blacklistCount: number
} {
  return {
    highValueCount: items.filter((i) => isHighValueBuyer(i)).length,
    repurchaseCount: items.filter((i) => isRepurchaseBuyer(i)).length,
    refundCount: items.filter((i) => isRefundRankingBuyer(i)).length,
    qualityHeavyCount: items.filter((i) => isQualityRankingBuyer(i)).length,
    blacklistCount: 0,
  }
}

export const BUYER_TAB_FILTER_DESCRIPTIONS = {
  spend: 'realDealAmountCent > 0（真实成交，排除未发货全退/已取消/已关闭）',
  repurchase: 'realDealOrderCount ≥ 2',
  refund: 'productRefundAmountCent > 0（不含纯运费退）',
  quality: 'buyerSummary.qualityRefundOrderCount > 0（官方品退命中）',
} as const
