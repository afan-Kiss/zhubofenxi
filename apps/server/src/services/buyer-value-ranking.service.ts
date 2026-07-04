import type { AnalyzedOrderView } from '../types/analysis'
import type { BuyerRankingItem } from './buyer-ranking.service'
import { buildBuyerRankingAllItems } from './buyer-ranking.service'
import {
  BUYER_RANKING_PRESET_LABELS,
  resolveBuyerRankingDateRange,
  resolveBuyerValueRankingPreset,
  type BuyerRankingPreset,
} from '../utils/buyer-ranking-date-range'
import {
  buildBuyerShopMapFromViews,
  type BuyerShopAggregate,
} from './buyer-shop-aggregate.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { buyerRankingRangeToAnalysisRange } from '../utils/buyer-ranking-date-range'
import { filterViewsForBuyerRanking, attachRawByMatchToViews } from './low-price-brush-order.service'
import { mapViewToBuyerOrderStandard } from './buyer-order-standard.service'
import { countAftersaleAppliesForViewRow } from './buyer-aftersale-event.util'
import { resolveBuyerIdentityFromView } from './buyer-identity.service'
import {
  buildBuyerValueRankingProfile,
  type BuyerValueCustomerType,
  type BuyerValueRankingItem,
  type BuyerValueRankingProfile,
  type BuyerValueRankingSummary,
  type BuyerValueRankingType,
  type BuyerValueCustomerMetrics,
  capBuyerValueRate,
  capBuyerValueCount,
  classifyBuyerValueCustomerType,
  computeAvgOrderScore,
  computeHighValueScore,
  computeHighValueScoreFromItem,
  computeMultiShopScore,
  computeRecencyScore,
  computeRepurchaseScore,
  computeRiskPenalty,
  computeSignedAmountScore,
  computeSignedRateScore,
  extractBuyerValueCustomerMetrics,
  isTrueHighValueCustomer,
} from './buyer-value-score.service'

export type {
  BuyerValueCustomerType,
  BuyerValueRankingType,
  BuyerValueCustomerMetrics,
  BuyerValueRankingProfile,
  BuyerValueRankingItem,
  BuyerValueRankingSummary,
}

export {
  capBuyerValueRate,
  capBuyerValueCount,
  extractBuyerValueCustomerMetrics,
  computeSignedAmountScore,
  computeRepurchaseScore,
  computeSignedRateScore,
  computeAvgOrderScore,
  computeRecencyScore,
  computeMultiShopScore,
  computeRiskPenalty,
  computeHighValueScore,
  classifyBuyerValueCustomerType,
  buildBuyerValueRankingProfile,
  computeHighValueScoreFromItem,
  isTrueHighValueCustomer,
}

function countAftersaleAppliesForView(v: AnalyzedOrderView): number {
  return countAftersaleAppliesForViewRow(v, mapViewToBuyerOrderStandard(v))
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
