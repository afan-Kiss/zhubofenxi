import type { BuyerRankingItem } from './buyer-ranking.service'
import { buildBuyerRankingAllItems } from './buyer-ranking.service'
import {
  resolveBuyerRankingDateRange,
  BUYER_RANKING_PRESET_LABELS,
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
import { formatMoneyYuanCompact } from './buyer-wechat-weekly-text.service'

export interface BadBuyerProfile {
  riskScore: number
  riskScoreText: string
  qualityRefundOrderCount: number
  returnRefundOrderCount: number
  afterSaleOrderCount: number
  disputeOrderCount: number
  refundRate: number | null
  refundAmountYuan: number
  reasonText: string
  suggestionText: string
  mainShopName: string
  shopLabel: string
}

export type BadBuyerRankingItem = BuyerRankingItem & {
  badBuyerProfile: BadBuyerProfile
}

export interface BadBuyerWechatTextRow {
  rank: number
  buyerDisplayName: string
  riskScoreText: string
  qualityRefundOrderCount: number
  returnRefundOrderCount: number
  afterSaleOrderCount: number
  refundRateLabel: string
  refundAmountYuan: number
  shopLabel: string
  reasonText: string
  suggestionText: string
}

function realDealOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.realDealOrderCount ?? item.signedOrderCount ?? item.orderCount ?? 0
}

export function qualityRefundOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
}

/** 退货退款单数（不含纯运费补偿） */
export function returnRefundOrderCount(item: BuyerRankingItem): number {
  return item.returnRefundCount ?? 0
}

export function afterSaleOrderCount(item: BuyerRankingItem): number {
  if (typeof item.afterSaleCount === 'number') return item.afterSaleCount
  const pending =
    item.buyerSummary?.pendingAfterSaleOrderCount ?? item.pendingAfterSaleOrderCount ?? 0
  const refund = item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
  const quality = qualityRefundOrderCount(item)
  return Math.max(pending, refund, quality, item.returnRefundCount ?? 0)
}

export function disputeOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.pendingAfterSaleOrderCount ?? item.pendingAfterSaleOrderCount ?? 0
}

export function productRefundAmountYuan(item: BuyerRankingItem): number {
  if (item.buyerSummary?.refundAmountCent != null) {
    return centToYuan(item.buyerSummary.refundAmountCent)
  }
  return Number(item.productRefundAmount ?? item.refundAmount ?? 0)
}

export function buyerRefundRate(item: BuyerRankingItem): number | null {
  const orders = realDealOrderCount(item)
  if (orders <= 0) return null
  const refundOrders = item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
  return refundOrders / orders
}

function isFreightOnlyBuyer(item: BuyerRankingItem): boolean {
  const freight = item.freightRefundCount ?? 0
  const productRefund = item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
  const productAmount = productRefundAmountYuan(item)
  return (
    freight > 0 &&
    productRefund <= 0 &&
    productAmount <= 0 &&
    returnRefundOrderCount(item) <= 0
  )
}

export function isBadBuyerCandidate(item: BuyerRankingItem): boolean {
  if (isFreightOnlyBuyer(item)) return false

  const qc = qualityRefundOrderCount(item)
  const rr = returnRefundOrderCount(item)
  const afterSale = afterSaleOrderCount(item)
  const rrRate = buyerRefundRate(item) ?? 0
  const dispute = disputeOrderCount(item)

  if (qc >= 1) return true
  if (rr >= 1) return true
  if (afterSale >= 2) return true
  if (rrRate >= 0.4) return true
  if (dispute >= 1) return true

  const risk = computeBadBuyerRiskScore(item)
  return risk >= 3 && (qc > 0 || rr > 0 || afterSale >= 2 || dispute >= 1)
}

export function computeBadBuyerRiskScore(item: BuyerRankingItem): number {
  const qc = qualityRefundOrderCount(item)
  const rr = returnRefundOrderCount(item)
  const dispute = disputeOrderCount(item)
  const rrRate = buyerRefundRate(item) ?? 0
  const refundAmount = productRefundAmountYuan(item)
  const afterSale = afterSaleOrderCount(item)
  const signed = item.signedOrderCount ?? 0

  let score = 0

  if (qc >= 3) score += 3
  else if (qc === 2) score += 2
  else if (qc === 1) score += 1.2

  if (rr >= 3) score += 2
  else if (rr === 2) score += 1.5
  else if (rr === 1) score += 1

  if (dispute >= 3) score += 2
  else if (dispute === 2) score += 1.5
  else if (dispute === 1) score += 1

  if (rrRate >= 0.7) score += 2
  else if (rrRate >= 0.5) score += 1.5
  else if (rrRate >= 0.4) score += 1
  else if (rrRate >= 0.3) score += 0.5

  if (refundAmount >= 5000) score += 1
  else if (refundAmount >= 3000) score += 0.8
  else if (refundAmount >= 1000) score += 0.5
  else if (refundAmount > 0) score += 0.2

  if (afterSale >= 5) score += 1
  else if (afterSale >= 3) score += 0.7
  else if (afterSale >= 2) score += 0.5

  if (signed >= 5 && rrRate < 0.2) score -= 2
  else if (signed >= 3 && rrRate < 0.2) score -= 1

  score = Math.max(0, Math.min(10, score))
  return Math.round(score * 10) / 10
}

export function formatBadBuyerRiskScoreText(score: number): string {
  return `${score.toFixed(1)}/10`
}

function buildReasonText(profile: Pick<BadBuyerProfile, 'qualityRefundOrderCount' | 'returnRefundOrderCount' | 'disputeOrderCount' | 'afterSaleOrderCount'>): string {
  const parts: string[] = []
  if (profile.qualityRefundOrderCount >= 1) parts.push('品退多')
  if (profile.returnRefundOrderCount >= 1) parts.push('退货多')
  if (profile.disputeOrderCount >= 1 || profile.afterSaleOrderCount >= 2) parts.push('售后纠纷多')
  return parts.length > 0 ? parts.join('、') : '售后偏多'
}

function buildSuggestionText(reason: string): string {
  if (reason.includes('售后纠纷')) {
    return '售前把细节讲清楚，必要时让客户确认后再发货'
  }
  return '发货前必须确认圈口、颜色、瑕疵和预期'
}

export function buildBadBuyerProfile(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
): BadBuyerProfile {
  const shopAgg = shop ?? { mainShopName: '未知店铺', shopNames: [] }
  const riskScore = computeBadBuyerRiskScore(item)
  const profileBase = {
    qualityRefundOrderCount: qualityRefundOrderCount(item),
    returnRefundOrderCount: returnRefundOrderCount(item),
    disputeOrderCount: disputeOrderCount(item),
    afterSaleOrderCount: afterSaleOrderCount(item),
  }
  const reasonText = buildReasonText(profileBase)

  return {
    riskScore,
    riskScoreText: formatBadBuyerRiskScoreText(riskScore),
    ...profileBase,
    refundRate: buyerRefundRate(item),
    refundAmountYuan: productRefundAmountYuan(item),
    reasonText,
    suggestionText: buildSuggestionText(reasonText),
    mainShopName: shopAgg.mainShopName,
    shopLabel: formatShopLabelForWechat(shopAgg),
  }
}

async function loadShopMapForRange(
  preset: string,
  startDate?: string,
  endDate?: string,
): Promise<Map<string, BuyerShopAggregate>> {
  const range = resolveBuyerRankingDateRange(preset, startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(buyerRankingRangeToAnalysisRange(range))
  if (!bundle) return new Map()
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const views = filterViewsForBuyerRanking(
    attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch),
  )
  return buildBuyerShopMapFromViews(views)
}

export async function buildBadBuyerRanking(params: {
  preset?: string
  startDate?: string
  endDate?: string
  limit?: number
}): Promise<{
  items: BadBuyerRankingItem[]
  range: {
    preset: string
    presetLabel: string
    startDate: string
    endDate: string
  }
  limit: number
  empty: boolean
  dataNote: string
}> {
  const preset = params.preset ?? 'recent30'
  const range = resolveBuyerRankingDateRange(preset, params.startDate, params.endDate)
  const limit = Math.min(10, Math.max(1, Math.floor(params.limit ?? 10)))

  const items = await buildBuyerRankingAllItems({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
    type: 'all',
  })

  const shopMap = await loadShopMapForRange(preset, params.startDate, params.endDate)

  const enriched: BadBuyerRankingItem[] = items
    .filter(isBadBuyerCandidate)
    .map((item) => {
      const badBuyerProfile = buildBadBuyerProfile(item, shopMap.get(item.buyerKey))
      return { ...item, badBuyerProfile }
    })
    .sort((a, b) => {
      const s = b.badBuyerProfile.riskScore - a.badBuyerProfile.riskScore
      if (s !== 0) return s
      return b.badBuyerProfile.qualityRefundOrderCount - a.badBuyerProfile.qualityRefundOrderCount
    })
    .slice(0, limit)

  const presetLabel =
    BUYER_RANKING_PRESET_LABELS[range.preset as BuyerRankingPreset] ?? range.preset

  return {
    items: enriched,
    range: {
      preset: range.preset,
      presetLabel,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    limit,
    empty: enriched.length === 0,
    dataNote: '不按主播区分；所有主播共用同一份公司公共客户榜。',
  }
}

export function formatBadBuyerWechatBlock(row: BadBuyerWechatTextRow): string {
  const refundRate = row.refundRateLabel
  return [
    `${row.rank}. ${row.buyerDisplayName}`,
    `垃圾风险分：${row.riskScoreText}`,
    `品退：${row.qualityRefundOrderCount} 单｜退货：${row.returnRefundOrderCount} 单｜售后：${row.afterSaleOrderCount} 单`,
    `退款率：${refundRate}｜退款金额：${formatMoneyYuanCompact(row.refundAmountYuan)}`,
    `店铺：${row.shopLabel}`,
    `原因：${row.reasonText}`,
    `建议：${row.suggestionText}`,
  ].join('\n')
}

export function composeBadBuyerWechatText(params: {
  title: string
  dateRangeLabel: string
  rows: BadBuyerWechatTextRow[]
}): string {
  if (params.rows.length === 0) {
    return `${params.title}\n时间：${params.dateRangeLabel}\n\n本期暂时没有符合条件的客户。`
  }
  return [
    params.title,
    `时间：${params.dateRangeLabel}`,
    '',
    params.rows.map(formatBadBuyerWechatBlock).join('\n\n'),
    '',
    '说明：这个榜单只用于发货前提醒和售前确认，不要在客户面前使用负面话术。',
  ].join('\n')
}

export async function buildBadBuyerWechatText(params: {
  preset?: string
  startDate?: string
  endDate?: string
  limit?: number
}): Promise<{
  title: string
  dateRangeLabel: string
  text: string
  rows: BadBuyerWechatTextRow[]
  empty: boolean
  dataNote: string
}> {
  const result = await buildBadBuyerRanking(params)
  const title = `【${result.range.presetLabel}垃圾客户榜单】`
  const dateRangeLabel = `${result.range.startDate} ~ ${result.range.endDate}`

  const rows: BadBuyerWechatTextRow[] = result.items.map((item, idx) => ({
    rank: idx + 1,
    buyerDisplayName: item.buyerDisplayName ?? item.nickname ?? '未知买家',
    riskScoreText: item.badBuyerProfile.riskScoreText,
    qualityRefundOrderCount: item.badBuyerProfile.qualityRefundOrderCount,
    returnRefundOrderCount: item.badBuyerProfile.returnRefundOrderCount,
    afterSaleOrderCount: item.badBuyerProfile.afterSaleOrderCount,
    refundRateLabel:
      item.badBuyerProfile.refundRate != null
        ? `${Math.round(item.badBuyerProfile.refundRate * 100)}%`
        : '—',
    refundAmountYuan: item.badBuyerProfile.refundAmountYuan,
    shopLabel: item.badBuyerProfile.shopLabel,
    reasonText: item.badBuyerProfile.reasonText,
    suggestionText: item.badBuyerProfile.suggestionText,
  }))

  return {
    title,
    dateRangeLabel,
    text: composeBadBuyerWechatText({ title, dateRangeLabel, rows }),
    rows,
    empty: result.empty,
    dataNote: result.dataNote,
  }
}
