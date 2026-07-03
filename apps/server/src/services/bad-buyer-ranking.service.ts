import type { AnalyzedOrderView } from '../types/analysis'
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
import { mapViewToBuyerOrderStandard } from './buyer-order-standard.service'
import { resolveBuyerIdentityFromView } from './buyer-identity.service'

export type BadBuyerRiskLevel = '低风险' | '关注' | '谨慎发货' | '重点确认' | '建议人工复核'

export interface BadBuyerCustomerStats {
  paidCount: number
  paidAmountCent: number
  signedCount: number | null
  signedAmountCent: number
  refundOrderCount: number
  refundAmountCent: number
  qualityRefundCount: number
  returnRefundCount: number
  aftersaleCount: number
  unsignedCount: number
  shopCount: number
  hasSignedData: boolean
}

export interface BadBuyerProfile {
  riskScore: number
  riskScoreText: string
  riskLevel: BadBuyerRiskLevel
  paidCount: number
  paidAmountYuan: number
  signedCount: number | null
  signedRate: number | null
  signedAmountYuan: number
  refundOrderCount: number
  refundRate: number
  amountRefundRate: number
  refundAmountYuan: number
  qualityRefundOrderCount: number
  returnRefundOrderCount: number
  aftersaleCount: number
  unsignedCount: number
  shopCount: number
  /** @deprecated 使用 signedCount */
  signedOrderCount: number
  /** @deprecated 使用 aftersaleCount */
  afterSaleOrderCount: number
  disputeOrderCount: number
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
  riskLevel: BadBuyerRiskLevel
  riskScoreText: string
  paidCount: number
  signedLine: string
  signedRateLabel: string
  refundOrderCount: number
  refundRateLabel: string
  refundAmountYuan: number
  qualityRefundOrderCount: number
  returnRefundOrderCount: number
  aftersaleCount: number
  shopLabel: string
  reasonText: string
  suggestionText: string
}

export const BAD_BUYER_LIST_TITLE_SUFFIX = '高风险售后客户提醒'

export function capBadBuyerRate(numerator: number, denominator: number, max = 1): number {
  if (denominator <= 0) return 0
  return Math.min(numerator / denominator, max)
}

export function capBadBuyerCount(value: number, max: number): number {
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

export function qualityRefundOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
}

/** 退货退款单数（不含纯运费补偿） */
export function returnRefundOrderCount(item: BuyerRankingItem): number {
  return item.returnRefundCount ?? 0
}

/** 售后申请次数（可大于订单数；不等于退款订单数） */
export function aftersaleApplyCount(
  item: BuyerRankingItem,
  override?: number,
): number {
  if (override != null) return Math.max(0, override)
  return Math.max(item.afterSaleCount ?? 0, item.refundCount ?? 0, 0)
}

/** @deprecated 使用 aftersaleApplyCount */
export function afterSaleOrderCount(item: BuyerRankingItem): number {
  return aftersaleApplyCount(item)
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

/** 发生退款的订单数（按订单去重，封顶 paidCount） */
export function badBuyerRefundOrderCount(item: BuyerRankingItem): number {
  return extractBadBuyerCustomerStats(item).refundOrderCount
}

export function buyerRefundRate(item: BuyerRankingItem): number {
  const stats = extractBadBuyerCustomerStats(item)
  return capBadBuyerRate(stats.refundOrderCount, stats.paidCount)
}

export function extractBadBuyerCustomerStats(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
  options?: { aftersaleApplyCount?: number },
): BadBuyerCustomerStats {
  const summary = item.buyerSummary
  const paidCount = summary?.paidOrderCount ?? item.paidOrderCount ?? item.orderCount ?? 0
  const paidAmountCent =
    summary?.payAmountCent ??
    (item.statPaidAmount != null
      ? Math.round(item.statPaidAmount * 100)
      : Math.round((item.gmv ?? 0) * 100))

  const hasSignedData = hasSignedTrackingData(item)
  const signedCount = hasSignedData ? (item.signedOrderCount ?? 0) : null
  const signedAmountCent = Math.round((item.signedAmount ?? 0) * 100)

  const summaryRefundOrders = summary?.refundOrderCount ?? 0
  const behaviorRefundOrders =
    (item.returnRefundCount ?? 0) + (item.refundOnlyCount ?? 0)
  const rawRefundOrders =
    summaryRefundOrders > 0 ? summaryRefundOrders : behaviorRefundOrders
  const refundOrderCount = capBadBuyerCount(rawRefundOrders, paidCount)

  const refundAmountCent =
    summary?.refundAmountCent ?? Math.round(productRefundAmountYuan(item) * 100)

  const qualityRefundCount = qualityRefundOrderCount(item)
  const returnRefundCount = returnRefundOrderCount(item)
  const aftersaleCount = aftersaleApplyCount(item, options?.aftersaleApplyCount)
  const unsignedCount = hasSignedData ? (item.unsignedOrderCount ?? 0) : 0
  const shopCount = Math.max(1, shop?.shopNames.length ?? 1)

  return {
    paidCount,
    paidAmountCent,
    signedCount,
    signedAmountCent,
    refundOrderCount,
    refundAmountCent,
    qualityRefundCount,
    returnRefundCount,
    aftersaleCount,
    unsignedCount,
    shopCount,
    hasSignedData,
  }
}

export function computeBadBuyerRiskScoreFromStats(stats: BadBuyerCustomerStats): number {
  const paid = stats.paidCount
  const refundRate = capBadBuyerRate(stats.refundOrderCount, paid)
  const amountRefundRate = capBadBuyerRate(stats.refundAmountCent, stats.paidAmountCent)
  const qualityRefundRate = capBadBuyerRate(stats.qualityRefundCount, paid)
  const returnRefundRate = capBadBuyerRate(stats.returnRefundCount, paid)
  const unsignedRate = capBadBuyerRate(stats.unsignedCount, paid)
  const aftersalePressureRate = capBadBuyerRate(stats.aftersaleCount, paid)
  const multiShopBonus =
    stats.shopCount >= 2 && stats.refundOrderCount >= 2 ? 0.5 : 0

  let score =
    refundRate * 3 +
    amountRefundRate * 2 +
    qualityRefundRate * 2 +
    returnRefundRate * 1.5 +
    aftersalePressureRate * 1 +
    unsignedRate * 1 +
    multiShopBonus

  score = Math.min(score, 10)
  return Math.round(score * 10) / 10
}

export function computeBadBuyerRiskLevel(score: number): BadBuyerRiskLevel {
  if (score < 3) return '低风险'
  if (score < 5) return '关注'
  if (score < 7) return '谨慎发货'
  if (score < 8.5) return '重点确认'
  return '建议人工复核'
}

export function formatBadBuyerRiskScoreText(score: number): string {
  return `${score.toFixed(1)}/10`
}

export function formatBadBuyerRefundRateLabel(rate: number): string {
  return `${Math.round(capBadBuyerRate(rate, 1) * 100)}%`
}

export function formatBadBuyerSignedRateLabel(
  signedCount: number | null,
  paidCount: number,
): string {
  if (signedCount == null || paidCount <= 0) return '—'
  return `${Math.round(capBadBuyerRate(signedCount, paidCount) * 100)}%`
}

export function formatBadBuyerSignedLine(
  signedCount: number | null,
  paidCount: number,
): string {
  if (signedCount == null) return '—'
  return `${signedCount} 单`
}

function buildReasonText(stats: BadBuyerCustomerStats): string {
  const paid = stats.paidCount
  const refundRate = capBadBuyerRate(stats.refundOrderCount, paid)
  const amountRefundRate = capBadBuyerRate(stats.refundAmountCent, stats.paidAmountCent)
  const qualityRefundRate = capBadBuyerRate(stats.qualityRefundCount, paid)
  const returnRefundRate = capBadBuyerRate(stats.returnRefundCount, paid)
  const unsignedRate = capBadBuyerRate(stats.unsignedCount, paid)
  const aftersalePressureRate = capBadBuyerRate(stats.aftersaleCount, paid)

  const parts: string[] = []
  if (qualityRefundRate >= 0.5) parts.push('品退比例偏高')
  if (returnRefundRate >= 0.5) parts.push('退货退款比例偏高')
  if (refundRate >= 0.8) parts.push('退款订单占比高')
  if (amountRefundRate >= 0.8) parts.push('退款金额占比高')
  if (stats.aftersaleCount >= 3 && aftersalePressureRate >= 1) parts.push('售后申请次数偏多')
  if (unsignedRate >= 0.5) parts.push('未签收比例偏高')
  if (stats.shopCount >= 2 && stats.refundOrderCount >= 2) parts.push('多店铺均出现售后记录')
  return parts.length > 0 ? parts.join('、') : '近期有售后记录，建议发货前确认细节'
}

function buildSuggestionText(reasonText: string): string {
  const suggestions: string[] = []
  if (reasonText.includes('品退比例偏高')) {
    suggestions.push('发货前重点确认成色、瑕疵、纹裂、色差、实拍图和证书信息')
  }
  if (reasonText.includes('退货退款比例偏高')) {
    suggestions.push('发货前确认客户是否接受实物细节，必要时让客户在聊天里明确确认后再发货')
  }
  if (reasonText.includes('退款金额占比高')) {
    suggestions.push('高客单订单建议人工复核，确认预算、圈口、实物细节和售后预期')
  }
  if (reasonText.includes('未签收比例偏高')) {
    suggestions.push('发货前确认收货地址、电话、签收意愿和收货时间')
  }
  if (reasonText.includes('售后申请次数偏多')) {
    suggestions.push('售前把细节讲清楚，尽量用实拍图/视频确认，减少反复售后')
  }
  if (suggestions.length === 0) {
    return '发货前确认圈口、瑕疵、颜色、重量、证书/实拍图，客户确认后再安排发货'
  }
  return suggestions.join('；')
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

  const stats = extractBadBuyerCustomerStats(item)
  const qc = stats.qualityRefundCount
  const rr = stats.returnRefundCount
  const afterSale = stats.aftersaleCount
  const refundRate = capBadBuyerRate(stats.refundOrderCount, stats.paidCount)
  const dispute = disputeOrderCount(item)

  if (qc >= 1) return true
  if (rr >= 1) return true
  if (afterSale >= 2) return true
  if (refundRate >= 0.4) return true
  if (dispute >= 1) return true

  const risk = computeBadBuyerRiskScoreFromStats(stats)
  return risk >= 3 && (qc > 0 || rr > 0 || afterSale >= 2 || dispute >= 1)
}

export function computeBadBuyerRiskScore(item: BuyerRankingItem): number {
  return computeBadBuyerRiskScoreFromStats(extractBadBuyerCustomerStats(item))
}

export function buildBadBuyerProfile(
  item: BuyerRankingItem,
  shop?: BuyerShopAggregate,
  options?: { aftersaleApplyCount?: number },
): BadBuyerProfile {
  const shopAgg = shop ?? { mainShopName: '未知店铺', shopNames: [] }
  const stats = extractBadBuyerCustomerStats(item, shopAgg, options)
  const riskScore = computeBadBuyerRiskScoreFromStats(stats)
  const refundRate = capBadBuyerRate(stats.refundOrderCount, stats.paidCount)
  const amountRefundRate = capBadBuyerRate(stats.refundAmountCent, stats.paidAmountCent)
  const signedRate =
    stats.signedCount != null && stats.paidCount > 0
      ? capBadBuyerRate(stats.signedCount, stats.paidCount)
      : null
  const reasonText = buildReasonText(stats)

  return {
    riskScore,
    riskScoreText: formatBadBuyerRiskScoreText(riskScore),
    riskLevel: computeBadBuyerRiskLevel(riskScore),
    paidCount: stats.paidCount,
    paidAmountYuan: centToYuan(stats.paidAmountCent),
    signedCount: stats.signedCount,
    signedRate,
    signedAmountYuan: centToYuan(stats.signedAmountCent),
    refundOrderCount: stats.refundOrderCount,
    refundRate,
    amountRefundRate,
    refundAmountYuan: centToYuan(stats.refundAmountCent),
    qualityRefundOrderCount: stats.qualityRefundCount,
    returnRefundOrderCount: stats.returnRefundCount,
    aftersaleCount: stats.aftersaleCount,
    unsignedCount: stats.unsignedCount,
    shopCount: stats.shopCount,
    signedOrderCount: stats.signedCount ?? 0,
    afterSaleOrderCount: stats.aftersaleCount,
    disputeOrderCount: disputeOrderCount(item),
    reasonText,
    suggestionText: buildSuggestionText(reasonText),
    mainShopName: shopAgg.mainShopName,
    shopLabel: formatShopLabelForWechat(shopAgg),
  }
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

async function loadBadBuyerContextForRange(
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

  const { shopMap, aftersaleApplyByBuyer } = await loadBadBuyerContextForRange(
    preset,
    params.startDate,
    params.endDate,
  )

  const enriched: BadBuyerRankingItem[] = items
    .filter(isBadBuyerCandidate)
    .map((item) => {
      const badBuyerProfile = buildBadBuyerProfile(item, shopMap.get(item.buyerKey), {
        aftersaleApplyCount: aftersaleApplyByBuyer.get(item.buyerKey),
      })
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
  return [
    `${row.rank}. ${row.buyerDisplayName}`,
    `风险等级：${row.riskLevel}｜风险分：${row.riskScoreText}`,
    `支付：${row.paidCount} 单｜签收：${row.signedLine}｜签收率：${row.signedRateLabel}`,
    `退款：${row.refundOrderCount} 单｜退款率：${row.refundRateLabel}｜退款金额：${formatMoneyYuanCompact(row.refundAmountYuan)}`,
    `品退：${row.qualityRefundOrderCount} 单｜退货退款：${row.returnRefundOrderCount} 单｜售后申请：${row.aftersaleCount} 次`,
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
    '说明：这个榜单只用于发货前提醒和售前确认，不要在客户面前使用负面话术。风险分不是拉黑依据，重点是帮助客服提前确认细节，减少不必要的售后。',
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
  const title = `【${result.range.presetLabel}${BAD_BUYER_LIST_TITLE_SUFFIX}】`
  const dateRangeLabel = `${result.range.startDate} ~ ${result.range.endDate}`

  const rows: BadBuyerWechatTextRow[] = result.items.map((item, idx) => {
    const p = item.badBuyerProfile
    return {
      rank: idx + 1,
      buyerDisplayName: item.buyerDisplayName ?? item.nickname ?? '未知买家',
      riskLevel: p.riskLevel,
      riskScoreText: p.riskScoreText,
      paidCount: p.paidCount,
      signedLine: formatBadBuyerSignedLine(p.signedCount, p.paidCount),
      signedRateLabel: formatBadBuyerSignedRateLabel(p.signedCount, p.paidCount),
      refundOrderCount: p.refundOrderCount,
      refundRateLabel: formatBadBuyerRefundRateLabel(p.refundRate),
      refundAmountYuan: p.refundAmountYuan,
      qualityRefundOrderCount: p.qualityRefundOrderCount,
      returnRefundOrderCount: p.returnRefundOrderCount,
      aftersaleCount: p.aftersaleCount,
      shopLabel: p.shopLabel,
      reasonText: p.reasonText,
      suggestionText: p.suggestionText,
    }
  })

  return {
    title,
    dateRangeLabel,
    text: composeBadBuyerWechatText({ title, dateRangeLabel, rows }),
    rows,
    empty: result.empty,
    dataNote: result.dataNote,
  }
}
