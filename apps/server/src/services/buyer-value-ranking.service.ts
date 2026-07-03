import type { AnalyzedOrderView } from '../types/analysis'
import type { BuyerRankingItem } from './buyer-ranking.service'
import { buildBuyerRankingAllItems } from './buyer-ranking.service'
import {
  BUYER_RANKING_PRESET_LABELS,
  resolveBuyerRankingDateRange,
  resolveBuyerValueRankingPreset,
  type BuyerRankingPreset,
} from '../utils/buyer-ranking-date-range'
import { centToYuan } from '../utils/money'
import {
  buildBuyerShopMapFromViews,
  formatShopLabelForWechat,
  type BuyerShopAggregate,
} from './buyer-shop-aggregate.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { buyerRankingRangeToAnalysisRange } from '../utils/buyer-ranking-date-range'
import { filterViewsForBuyerRanking, attachRawByMatchToViews } from './low-price-brush-order.service'
import { mapViewToBuyerOrderStandard } from './buyer-order-standard.service'
import { resolveBuyerIdentityFromView } from './buyer-identity.service'

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

function countAftersaleAppliesForView(v: AnalyzedOrderView): number {
  if (v.isFreightRefundOnly) return 0
  const row = mapViewToBuyerOrderStandard(v)
  if (row.afterSaleNo) {
    const ids = row.afterSaleNo.split('、').map((s) => s.trim()).filter(Boolean)
    if (ids.length > 0) return ids.length
  }
  if (
    row.hasEffectiveAfterSale ||
    row.refundAmountPending ||
    row.refundAmountCent > 0 ||
    v.isReturnRefund ||
    v.isRefundOnly ||
    v.afterSaleClosedNoRefund ||
    v.isQualityReturn
  ) {
    return 1
  }
  return 0
}

function buildAftersaleApplyCountByBuyer(views: AnalyzedOrderView[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const v of views) {
    const identity = resolveBuyerIdentityFromView(v)
    if (!identity) continue
    const n = countAftersaleAppliesForView(v)
    if (n <= 0) continue
    map.set(identity.buyerKey, (map.get(identity.buyerKey) ?? 0) + n)
  }
  return map
}

async function loadBuyerValueContextForRange(
  preset: string,
  startDate?: string,
  endDate?: string,
): Promise<{
  shopMap: Map<string, BuyerShopAggregate>
  aftersaleApplyByBuyer: Map<string, number>
}> {
  const range = resolveBuyerRankingDateRange(preset, startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(buyerRankingRangeToAnalysisRange(range))
  if (!bundle) {
    return { shopMap: new Map(), aftersaleApplyByBuyer: new Map() }
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const views = filterViewsForBuyerRanking(
    attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch),
  )
  return {
    shopMap: buildBuyerShopMapFromViews(views),
    aftersaleApplyByBuyer: buildAftersaleApplyCountByBuyer(views),
  }
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

function sortBuyerValueRankingItems(
  items: BuyerValueRankingItem[],
  type: BuyerValueRankingType,
): BuyerValueRankingItem[] {
  const list = [...items]
  if (type === 'high_spend_need_attention') {
    list.sort((a, b) => {
      const pa = b.valueRankingProfile.metrics.paidAmountCent - a.valueRankingProfile.metrics.paidAmountCent
      if (pa !== 0) return pa
      const rp = b.valueRankingProfile.riskPenalty - a.valueRankingProfile.riskPenalty
      if (rp !== 0) return rp
      return b.valueRankingProfile.metrics.refundAmountCent - a.valueRankingProfile.metrics.refundAmountCent
    })
    return list
  }
  if (type === 'potential') {
    list.sort((a, b) => {
      const av =
        b.valueRankingProfile.metrics.avgValidAmountCent - a.valueRankingProfile.metrics.avgValidAmountCent
      if (av !== 0) return av
      return String(b.valueRankingProfile.metrics.lastPayTime ?? '').localeCompare(
        String(a.valueRankingProfile.metrics.lastPayTime ?? ''),
      )
    })
    return list
  }
  list.sort((a, b) => {
    const s = b.valueRankingProfile.highValueScore - a.valueRankingProfile.highValueScore
    if (s !== 0) return s
    const sa =
      b.valueRankingProfile.metrics.signedAmountCent - a.valueRankingProfile.metrics.signedAmountCent
    if (sa !== 0) return sa
    const vc =
      b.valueRankingProfile.metrics.validOrderCount - a.valueRankingProfile.metrics.validOrderCount
    if (vc !== 0) return vc
    return String(b.valueRankingProfile.metrics.lastPayTime ?? '').localeCompare(
      String(a.valueRankingProfile.metrics.lastPayTime ?? ''),
    )
  })
  return list
}

function filterByCustomerType(
  items: BuyerValueRankingItem[],
  type: BuyerValueRankingType,
): BuyerValueRankingItem[] {
  if (type === 'all') return items
  if (type === 'potential') {
    return items.filter((i) => i.valueRankingProfile.customerType === 'potential_customer')
  }
  if (type === 'high_spend_need_attention') {
    return items.filter((i) => i.valueRankingProfile.customerType === 'high_spend_need_attention')
  }
  return items.filter((i) => i.valueRankingProfile.customerType === 'true_high_value')
}

function buildSummary(allItems: BuyerValueRankingItem[]): BuyerValueRankingSummary {
  let signedRateSum = 0
  let signedRateCount = 0
  let refundRateSum = 0
  let refundRateCount = 0
  let totalSignedAmountCent = 0

  for (const item of allItems) {
    const m = item.valueRankingProfile.metrics
    totalSignedAmountCent += m.signedAmountCent
    if (m.signedRate != null) {
      signedRateSum += m.signedRate
      signedRateCount += 1
    }
    if (m.paidOrderCount > 0) {
      refundRateSum += m.refundRate
      refundRateCount += 1
    }
  }

  return {
    totalBuyerCount: allItems.length,
    trueHighValueCount: allItems.filter((i) => i.valueRankingProfile.customerType === 'true_high_value').length,
    highSpendNeedAttentionCount: allItems.filter(
      (i) => i.valueRankingProfile.customerType === 'high_spend_need_attention',
    ).length,
    potentialCustomerCount: allItems.filter(
      (i) => i.valueRankingProfile.customerType === 'potential_customer',
    ).length,
    totalSignedAmountCent,
    avgSignedRate: signedRateCount > 0 ? signedRateSum / signedRateCount : null,
    avgRefundRate: refundRateCount > 0 ? refundRateSum / refundRateCount : 0,
  }
}

export async function buildBuyerValueRanking(params: {
  preset?: string
  startDate?: string
  endDate?: string
  type?: BuyerValueRankingType
  limit?: number
}): Promise<{
  range: {
    preset: string
    presetLabel: string
    startDate: string
    endDate: string
    isAll: boolean
  }
  summary: BuyerValueRankingSummary
  items: BuyerValueRankingItem[]
  limit: number
  empty: boolean
  dataNote: string
}> {
  const presetKey = resolveBuyerValueRankingPreset(params.preset ?? 'last90d')
  const range = resolveBuyerRankingDateRange(presetKey, params.startDate, params.endDate)
  const type = params.type ?? 'true_high_value'
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 50)))

  const items = await buildBuyerRankingAllItems({
    preset: presetKey,
    startDate: params.startDate,
    endDate: params.endDate,
    type: 'all',
  })

  const { shopMap, aftersaleApplyByBuyer } = await loadBuyerValueContextForRange(
    presetKey,
    params.startDate,
    params.endDate,
  )

  const enriched: BuyerValueRankingItem[] = items
    .filter((item) => (item.buyerSummary?.paidOrderCount ?? item.paidOrderCount ?? 0) > 0)
    .map((item) => ({
      ...item,
      valueRankingProfile: buildBuyerValueRankingProfile(item, shopMap.get(item.buyerKey), {
        aftersaleApplyCount: aftersaleApplyByBuyer.get(item.buyerKey),
      }),
    }))

  const summary = buildSummary(enriched)
  const filtered = filterByCustomerType(enriched, type)
  const sorted = sortBuyerValueRankingItems(filtered, type).slice(0, limit)

  const presetLabel =
    BUYER_RANKING_PRESET_LABELS[range.preset as BuyerRankingPreset] ?? range.preset

  return {
    range: {
      preset: range.preset,
      presetLabel,
      startDate: range.startDate,
      endDate: range.endDate,
      isAll: range.isAll,
    },
    summary,
    items: sorted,
    limit,
    empty: sorted.length === 0,
    dataNote:
      range.isAll
        ? '全量历史客户画像；支付基数低于 ¥29 的订单已剔除；按 buyerKey 聚合。'
        : `按支付时间 ${range.startDate} ~ ${range.endDate} 统计；支付基数低于 ¥29 的订单已剔除。`,
  }
}

/** 供 buyer-value-profile 复用：与榜单一致的高价值分 */
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
