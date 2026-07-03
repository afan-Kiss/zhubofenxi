import type { BuyerRankingItem } from './buyer-ranking.service'
import { isTrueHighValueCustomer } from './buyer-value-ranking.service'

/** 高价值客户：实际签收金额 ≥ 1000 元 */
export const HIGH_VALUE_MIN_SIGNED_YUAN = 1000

/** 高价值客户：至少签收单数 */
export const HIGH_VALUE_MIN_SIGNED_ORDER_COUNT = 1

export function isQualityHeavyBuyer(item: BuyerRankingItem): boolean {
  const qualityCount = item.buyerSummary?.qualityRefundOrderCount ?? item.qualityReturnCount
  return (
    qualityCount >= 2 ||
    (item.orderCount > 0 && qualityCount / item.orderCount >= 0.3)
  )
}

export function isHighValueBuyer(item: BuyerRankingItem): boolean {
  return isTrueHighValueCustomer(item)
}

export function isRepurchaseBuyer(item: BuyerRankingItem): boolean {
  const realDealOrders = item.buyerSummary?.realDealOrderCount
  if (realDealOrders != null) return realDealOrders >= 2
  return item.orderCount >= 2
}

export function isAfterSaleHeavyBuyer(item: BuyerRankingItem): boolean {
  const refundOrders = item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
  const productRefundRate = item.orderCount > 0 ? refundOrders / item.orderCount : 0
  return refundOrders >= 3 || productRefundRate >= 0.4
}

export function isFocusBuyer(item: BuyerRankingItem): boolean {
  const productRefundRate =
    item.orderCount > 0 ? (item.returnRefundCount + item.refundOnlyCount) / item.orderCount : 0
  return (
    item.signedAmount >= HIGH_VALUE_MIN_SIGNED_YUAN * 0.5 &&
    (productRefundRate >= 0.25 || item.qualityReturnCount >= 1) &&
    !isAfterSaleHeavyBuyer(item)
  )
}

export function isCautiousShipBuyer(item: BuyerRankingItem): boolean {
  const signedRate = item.orderCount > 0 ? item.signedOrderCount / item.orderCount : 0
  const productRefundRate =
    item.orderCount > 0 ? (item.returnRefundCount + item.refundOnlyCount) / item.orderCount : 0
  return productRefundRate >= 0.6 || (item.returnRefundCount >= 3 && signedRate < 0.3)
}

export const BUYER_SUMMARY_FORMULAS = {
  highValue: `真正高价值：高价值分≥7、有效签收≥2单、签收金额≥3000元、退款率≤20%、无品退、无售后处理中`,
  repurchase: '同一 buyerKey 真实成交订单数 realDealOrderCount ≥ 2',
  refund: '商品退款金额>0 或 成功商品退款次数>0',
  qualityHeavy: '品退次数 > 0（官方品质负反馈 + 售后商品问题交叉识别）',
} as const

export function buildHighValueCustomerDefinition(): {
  label: string
  ruleText: string
  amountThreshold: number
  orderCountThreshold: number
} {
  return {
    label: '高价值客户',
    ruleText: BUYER_SUMMARY_FORMULAS.highValue,
    amountThreshold: HIGH_VALUE_MIN_SIGNED_YUAN,
    orderCountThreshold: HIGH_VALUE_MIN_SIGNED_ORDER_COUNT,
  }
}

export const BUYER_SUMMARY_EMPTY: Record<string, string> = {
  highValue: '当前范围暂无高价值客户',
  repurchase: '当前范围暂无复购客户',
  refund: '当前范围暂无退款客户',
  qualityHeavy:
    '本期暂无商品问题类退货订单。品退榜只统计商品问题、质量问题、瑕疵、破损、描述不符等原因；尺码不合适、多拍拍错、不想要等普通原因不计入品退。',
}
