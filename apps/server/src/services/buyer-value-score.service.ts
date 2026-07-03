/**
 * 高价值客户评分（纯函数，不依赖 buyer-ranking.service 运行时导入，避免循环依赖）
 */
import type { BuyerRankingItem } from './buyer-ranking.service'
import { centToYuan } from '../utils/money'
import { formatShopLabelForWechat, type BuyerShopAggregate } from './buyer-shop-aggregate.service'

export type BuyerValueCustomerType =
  | 'true_high_value'
  | 'high_spend_need_attention'
  | 'potential_customer'
  | 'other'

export type BuyerValueRankingType =
  | 'true_high_value'
  | 'high_spend_need_attention'
  | 'potential'
  | 'all'

export interface BuyerValueCustomerMetrics {
  buyerId: string
  buyerName: string
  shopCount: number
  firstPayTime: string | null
  lastPayTime: string | null
  paidOrderCount: number
  paidAmountCent: number
  validOrderCount: number
  validAmountCent: number
  signedOrderCount: number | null
  signedAmountCent: number
  refundOrderCount: number
  refundAmountCent: number
  aftersaleCount: number
  qualityRefundCount: number
  returnRefundCount: number
  pendingAftersaleCount: number
  unsignedOrderCount: number
  signedRate: number | null
  refundRate: number
  amountRefundRate: number
  avgValidAmountCent: number
  hasSignedData: boolean
}

export interface BuyerValueRankingProfile {
  highValueScore: number
  highValueScoreText: string
  highValueLevel: string
  customerType: BuyerValueCustomerType
  customerTypeLabel: string
  riskPenalty: number
  reasons: string[]
  suggestions: string[]
  metrics: BuyerValueCustomerMetrics
  shopLabel: string
  mainShopName: string
}

export type BuyerValueRankingItem = BuyerRankingItem & {
  valueRankingProfile: BuyerValueRankingProfile
}

export interface BuyerValueRankingSummary {
  totalBuyerCount: number
  trueHighValueCount: number
  highSpendNeedAttentionCount: number
  potentialCustomerCount: number
  totalSignedAmountCent: number
  avgSignedRate: number | null
  avgRefundRate: number
}

export function capBuyerValueRate(numerator: number, denominator: number, max = 1): number {
  if (denominator <= 0) return 0
  return Math.min(numerator / denominator, max)
}

export function capBuyerValueCount(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(Math.max(0, value), max)
}

function hasSignedTrackingData(item: BuyerRankingItem): boolean {
  return (
    (item.signedOrderCount ?? 0) +
      (item.unsignedOrderCount ?? 0) +
      (item.completedOrderCount ?? 0) >
    0
  )
}

export function extractBuyerValueCustomerMetrics(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
  options?: { aftersaleApplyCount?: number },
): BuyerValueCustomerMetrics {
  const summary = item.buyerSummary
  const paidOrderCount = summary?.paidOrderCount ?? item.paidOrderCount ?? 0
  const paidAmountCent = summary?.payAmountCent ?? Math.round((item.gmv ?? 0) * 100)
  const validOrderCount = summary?.realDealOrderCount ?? 0
  const validAmountCent =
    summary?.realDealAmountCent ?? summary?.netDealAmountCent ?? Math.round((item.actualDealAmount ?? 0) * 100)

  const hasSignedData = hasSignedTrackingData(item)
  const signedOrderCount = hasSignedData ? (item.signedOrderCount ?? 0) : null
  const signedAmountCent = Math.round((item.signedAmount ?? 0) * 100)

  const rawRefundOrders = summary?.refundOrderCount ?? (item.returnRefundCount ?? 0) + (item.refundOnlyCount ?? 0)
  const refundOrderCount = capBuyerValueCount(rawRefundOrders, paidOrderCount)
  const refundAmountCent = summary?.refundAmountCent ?? Math.round((item.productRefundAmount ?? 0) * 100)
  const qualityRefundCount = summary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
  const returnRefundCount = item.returnRefundCount ?? 0
  const pendingAftersaleCount = summary?.pendingAfterSaleOrderCount ?? item.pendingAfterSaleOrderCount ?? 0
  const unsignedOrderCount = hasSignedData ? (item.unsignedOrderCount ?? 0) : 0
  const aftersaleCount =
    options?.aftersaleApplyCount ??
    Math.max(item.afterSaleCount ?? 0, item.refundCount ?? 0, 0)

  const signedRate =
    signedOrderCount != null && paidOrderCount > 0
      ? capBuyerValueRate(signedOrderCount, paidOrderCount)
      : null
  const refundRate = capBuyerValueRate(refundOrderCount, paidOrderCount)
  const amountRefundRate = capBuyerValueRate(refundAmountCent, paidAmountCent)
  const avgValidAmountCent =
    validOrderCount > 0 ? Math.round(validAmountCent / validOrderCount) : 0

  return {
    buyerId: item.buyerId ?? item.buyerKey,
    buyerName: item.buyerDisplayName ?? item.nickname ?? '未知买家',
    shopCount: Math.max(1, shop?.shopNames.length ?? 1),
    firstPayTime: null,
    lastPayTime: item.lastOrderTime ?? null,
    paidOrderCount,
    paidAmountCent,
    validOrderCount,
    validAmountCent,
    signedOrderCount,
    signedAmountCent,
    refundOrderCount,
    refundAmountCent,
    aftersaleCount,
    qualityRefundCount,
    returnRefundCount,
    pendingAftersaleCount,
    unsignedOrderCount,
    signedRate,
    refundRate,
    amountRefundRate,
    avgValidAmountCent,
    hasSignedData,
  }
}

export function computeSignedAmountScore(signedAmountCent: number): number {
  const yuan = centToYuan(signedAmountCent)
  if (yuan >= 20000) return 3
  if (yuan >= 10000) return 2.5
  if (yuan >= 5000) return 2
  if (yuan >= 3000) return 1.5
  if (yuan >= 1000) return 1
  if (yuan > 0) return 0.5
  return 0
}

export function computeRepurchaseScore(validOrderCount: number): number {
  if (validOrderCount >= 5) return 2
  if (validOrderCount >= 3) return 1.5
  if (validOrderCount >= 2) return 1
  if (validOrderCount === 1) return 0.3
  return 0
}

export function computeSignedRateScore(signedRate: number | null): number {
  if (signedRate == null) return 0
  if (signedRate >= 0.9) return 2
  if (signedRate >= 0.75) return 1.5
  if (signedRate >= 0.6) return 1
  if (signedRate >= 0.4) return 0.5
  return 0
}

export function computeAvgOrderScore(avgValidAmountCent: number, validOrderCount: number): number {
  if (validOrderCount <= 0) return 0
  const yuan = centToYuan(avgValidAmountCent)
  if (yuan >= 5000) return 1
  if (yuan >= 3000) return 0.8
  if (yuan >= 1500) return 0.5
  return 0.2
}

export function computeRecencyScore(lastPayTime: string | null, now = Date.now()): number {
  if (!lastPayTime || lastPayTime === '—') return 0
  const ms = Date.parse(lastPayTime.replace(' ', 'T') + (lastPayTime.includes('+') ? '' : '+08:00'))
  if (!Number.isFinite(ms)) return 0
  const days = (now - ms) / 86_400_000
  if (days <= 30) return 1
  if (days <= 90) return 0.7
  if (days <= 180) return 0.3
  return 0
}

export function computeMultiShopScore(metrics: BuyerValueCustomerMetrics): number {
  if (metrics.shopCount >= 2 && metrics.refundOrderCount === 0 && (metrics.signedOrderCount ?? 0) >= 2) {
    return 1
  }
  if (metrics.shopCount >= 2 && metrics.refundRate <= 0.2) return 0.5
  return 0
}

export function computeRiskPenalty(metrics: BuyerValueCustomerMetrics): number {
  const paid = metrics.paidOrderCount
  const refundRate = capBuyerValueRate(metrics.refundOrderCount, paid)
  const unsignedRate = capBuyerValueRate(metrics.unsignedOrderCount, paid)
  let penalty = 0
  if (refundRate >= 0.5) penalty += 3
  else if (refundRate >= 0.3) penalty += 2
  else if (refundRate >= 0.1) penalty += 1
  if (metrics.qualityRefundCount >= 1) penalty += 1.5
  if (metrics.returnRefundCount >= 1) penalty += 1.2
  if (metrics.pendingAftersaleCount >= 1) penalty += 1
  if (unsignedRate >= 0.5) penalty += 1.5
  if (metrics.aftersaleCount >= 3) penalty += 1
  return penalty
}

export function computeHighValueScore(metrics: BuyerValueCustomerMetrics, now = Date.now()): number {
  const score =
    computeSignedAmountScore(metrics.signedAmountCent) +
    computeRepurchaseScore(metrics.validOrderCount) +
    computeSignedRateScore(metrics.signedRate) +
    computeAvgOrderScore(metrics.avgValidAmountCent, metrics.validOrderCount) +
    computeRecencyScore(metrics.lastPayTime, now) +
    computeMultiShopScore(metrics) -
    computeRiskPenalty(metrics)
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10
}

export function classifyBuyerValueCustomerType(
  metrics: BuyerValueCustomerMetrics,
  highValueScore: number,
  now = Date.now(),
): BuyerValueCustomerType {
  const signedAmountYuan = centToYuan(metrics.signedAmountCent)
  const signedCount = metrics.signedOrderCount ?? 0
  const unsignedRate = capBuyerValueRate(metrics.unsignedOrderCount, metrics.paidOrderCount)
  const avgValidYuan = centToYuan(metrics.avgValidAmountCent)
  const recency90 = computeRecencyScore(metrics.lastPayTime, now) >= 0.7

  if (
    highValueScore >= 7 &&
    signedCount >= 2 &&
    signedAmountYuan >= 3000 &&
    metrics.refundRate <= 0.2 &&
    metrics.qualityRefundCount === 0 &&
    metrics.pendingAftersaleCount === 0
  ) {
    return 'true_high_value'
  }

  if (
    signedCount === 1 &&
    metrics.refundOrderCount === 0 &&
    metrics.qualityRefundCount === 0 &&
    metrics.pendingAftersaleCount === 0 &&
    avgValidYuan >= 1500 &&
    recency90
  ) {
    return 'potential_customer'
  }

  const highSpend =
    centToYuan(metrics.paidAmountCent) >= 3000 || metrics.paidOrderCount >= 3
  if (
    highSpend &&
    (metrics.refundRate > 0.2 ||
      metrics.qualityRefundCount > 0 ||
      metrics.returnRefundCount > 0 ||
      metrics.pendingAftersaleCount > 0 ||
      unsignedRate >= 0.4)
  ) {
    return 'high_spend_need_attention'
  }

  return 'other'
}

const CUSTOMER_TYPE_LABELS: Record<BuyerValueCustomerType, string> = {
  true_high_value: '真正高价值客户',
  high_spend_need_attention: '高消费但需关注',
  potential_customer: '潜力客户',
  other: '普通客户',
}

function buildReasons(metrics: BuyerValueCustomerMetrics, score: number): string[] {
  const reasons: string[] = []
  if (metrics.validOrderCount >= 2) reasons.push('复购稳定')
  if (centToYuan(metrics.signedAmountCent) >= 3000) reasons.push('签收金额高')
  if (metrics.refundOrderCount === 0 && metrics.pendingAftersaleCount === 0) {
    reasons.push('无售后退款')
  }
  if ((metrics.signedRate ?? 0) >= 0.75) reasons.push('签收率较好')
  if (metrics.shopCount >= 2 && metrics.refundRate <= 0.2) reasons.push('多店正常购买')
  if (metrics.refundRate > 0.2) reasons.push('退款占比偏高')
  if (metrics.qualityRefundCount > 0) reasons.push('存在品退记录')
  if (metrics.pendingAftersaleCount > 0) reasons.push('有售后处理中')
  if (metrics.unsignedOrderCount > 0 && capBuyerValueRate(metrics.unsignedOrderCount, metrics.paidOrderCount) >= 0.4) {
    reasons.push('未签收占比偏高')
  }
  if (reasons.length === 0) {
    if (score >= 5) reasons.push('成交表现正常')
    else reasons.push('继续观察')
  }
  return reasons
}

function buildSuggestions(customerType: BuyerValueCustomerType, reasons: string[]): string[] {
  if (customerType === 'true_high_value') {
    return ['适合重点维护，可做新品预告和老客复购提醒']
  }
  if (customerType === 'potential_customer') {
    return ['已完成首单签收，无售后，客单价较好，适合做二次触达']
  }
  if (customerType === 'high_spend_need_attention') {
    return ['支付金额较高，但退款/售后/未签收占比偏高，发货前建议重点确认']
  }
  if (reasons.includes('存在品退记录')) {
    return ['发货前重点确认成色、瑕疵、实拍图和证书信息']
  }
  return ['发货前确认圈口、瑕疵、颜色、重量、证书/实拍图，客户确认后再安排发货']
}

export function buildBuyerValueRankingProfile(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
  options?: { aftersaleApplyCount?: number; now?: number },
): BuyerValueRankingProfile {
  const shopAgg = shop ?? { mainShopName: '未知店铺', shopNames: [] }
  const metrics = extractBuyerValueCustomerMetrics(item, shopAgg, options)
  const now = options?.now ?? Date.now()
  const highValueScore = computeHighValueScore(metrics, now)
  const customerType = classifyBuyerValueCustomerType(metrics, highValueScore, now)
  const reasons = buildReasons(metrics, highValueScore)
  const suggestions = buildSuggestions(customerType, reasons)

  let highValueLevel = '普通'
  if (highValueScore >= 8) highValueLevel = '重点维护'
  else if (highValueScore >= 6) highValueLevel = '值得维护'
  else if (highValueScore >= 4) highValueLevel = '正常维护'

  return {
    highValueScore,
    highValueScoreText: `${highValueScore.toFixed(1)}/10`,
    highValueLevel,
    customerType,
    customerTypeLabel: CUSTOMER_TYPE_LABELS[customerType],
    riskPenalty: computeRiskPenalty(metrics),
    reasons,
    suggestions,
    metrics,
    shopLabel: formatShopLabelForWechat(shopAgg),
    mainShopName: shopAgg.mainShopName,
  }
}

export function computeHighValueScoreFromItem(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
): number {
  return computeHighValueScore(extractBuyerValueCustomerMetrics(item, shop))
}

export function isTrueHighValueCustomer(item: BuyerRankingItem, shop?: BuyerShopAggregate): boolean {
  const profile = buildBuyerValueRankingProfile(item, shop)
  return profile.customerType === 'true_high_value'
}
