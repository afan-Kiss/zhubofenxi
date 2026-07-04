import type { AnalyzedOrderView } from '../types/analysis'
import type { BuyerRankingItem } from './buyer-ranking.service'
import { buildBadBuyerRankingAllItems } from './buyer-ranking.service'
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
import {
  enforceBadBuyerRefundConsistency,
  isBadBuyerRefundStatsConsistent,
} from './bad-buyer-refund-consistency.service'
import {
  countAftersaleAppliesForViewRow,
  viewAfterSaleEventInBuyerRankingRange,
  viewPayTimeInBuyerRankingRange,
} from './buyer-aftersale-event.util'

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
  afterSaleOrderCount: number
  unsignedCount: number
  shopCount: number
  hasSignedData: boolean
  historicalRefundOnly: boolean
  inconsistent: boolean
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
  /** 售后申请次数（事件级，可大于订单数） */
  aftersaleCount: number
  /** 售后订单数（order 级去重） */
  afterSaleOrderCount: number
  unsignedCount: number
  shopCount: number
  /** 本期无支付、仅有历史订单在本期发生售后/退款 */
  historicalRefundOnly: boolean
  /** @deprecated 使用 signedCount */
  signedOrderCount: number
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
  paidLine: string
  historicalRefundOnly: boolean
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
  return item.buyerSummary?.qualityRefundOrderCount ?? 0
}

/** 退货退款单数（order 级；与 Drawer / 汇总口径一致） */
export function returnRefundOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.returnRefundOrderCount ?? 0
}

/** 售后申请次数（事件级，可大于订单数） */
export function aftersaleApplyCount(
  item: BuyerRankingItem,
  override?: number,
): number {
  if (override != null) return Math.max(0, override)
  return Math.max(item.afterSaleCount ?? 0, 0)
}

/** 售后订单数（order 级去重） */
export function afterSaleOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.afterSaleOrderCount ?? 0
}

export function disputeOrderCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.pendingAfterSaleOrderCount ?? item.pendingAfterSaleOrderCount ?? 0
}

/** @deprecated 使用 aftersaleApplyCount */
export function afterSaleApplyCountLegacy(item: BuyerRankingItem): number {
  return aftersaleApplyCount(item)
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
  const paidCount = summary?.paidOrderCount ?? 0
  const paidAmountCent = summary?.payAmountCent ?? 0

  const hasSignedData = hasSignedTrackingData(item)
  const signedCount = hasSignedData ? (item.signedOrderCount ?? 0) : null
  const signedAmountCent = Math.round((item.signedAmount ?? 0) * 100)

  const qualityRefundCount = summary?.qualityRefundOrderCount ?? 0
  const returnRefundCount = summary?.returnRefundOrderCount ?? 0
  const afterSaleOrderCountValue = summary?.afterSaleOrderCount ?? 0
  const aftersaleCount = aftersaleApplyCount(item, options?.aftersaleApplyCount)

  const rawRefundOrders = summary?.refundOrderCount ?? 0
  const rawRefundAmountCent = summary?.refundAmountCent ?? 0

  const enforced = enforceBadBuyerRefundConsistency({
    buyerKey: item.buyerKey,
    paidCount,
    refundOrderCount: rawRefundOrders,
    refundAmountCent: rawRefundAmountCent,
  })

  const unsignedCount = hasSignedData ? (item.unsignedOrderCount ?? 0) : 0
  const shopCount = Math.max(1, shop?.shopNames.length ?? 1)

  return {
    paidCount,
    paidAmountCent,
    signedCount,
    signedAmountCent,
    refundOrderCount: enforced.refundOrderCount,
    refundAmountCent: enforced.refundAmountCent,
    qualityRefundCount,
    returnRefundCount,
    aftersaleCount,
    afterSaleOrderCount: afterSaleOrderCountValue,
    unsignedCount,
    shopCount,
    hasSignedData,
    historicalRefundOnly: enforced.historicalRefundOnly,
    inconsistent: enforced.inconsistent,
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
  const summary = item.buyerSummary
  const freight = summary?.freightRefundAmountCent ?? item.freightRefundCount ?? 0
  const productRefund = summary?.refundOrderCount ?? 0
  const productAmount = summary?.refundAmountCent ?? 0
  return (
    freight > 0 &&
    productRefund <= 0 &&
    productAmount <= 0 &&
    (summary?.returnRefundOrderCount ?? 0) <= 0
  )
}

export function hasBadBuyerOrderSignal(stats: BadBuyerCustomerStats): boolean {
  return (
    stats.refundOrderCount > 0 ||
    stats.qualityRefundCount > 0 ||
    stats.returnRefundCount > 0 ||
    stats.afterSaleOrderCount > 0 ||
    stats.aftersaleCount > 0
  )
}

export function isBadBuyerCandidate(item: BuyerRankingItem): boolean {
  if (isFreightOnlyBuyer(item)) return false
  if (!item.buyerSummary) return false

  const stats = extractBadBuyerCustomerStats(item)
  if (stats.inconsistent) return false
  if (!isBadBuyerRefundStatsConsistent(stats)) return false
  if (!hasBadBuyerOrderSignal(stats)) return false

  const qc = stats.qualityRefundCount
  const rr = stats.returnRefundCount
  const afterSaleOrders = stats.afterSaleOrderCount
  const afterSale = stats.aftersaleCount
  const refundRate = capBadBuyerRate(stats.refundOrderCount, stats.paidCount)
  const dispute = disputeOrderCount(item)

  if (qc >= 1) return true
  if (rr >= 1) return true
  if (afterSaleOrders >= 1) return true
  if (afterSale >= 2) return true
  if (stats.refundOrderCount >= 1) return true
  if (refundRate >= 0.4 && stats.paidCount > 0) return true
  if (dispute >= 1) return true

  const risk = computeBadBuyerRiskScoreFromStats(stats)
  return risk >= 3 && hasBadBuyerOrderSignal(stats)
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
    afterSaleOrderCount: stats.afterSaleOrderCount,
    unsignedCount: stats.unsignedCount,
    shopCount: stats.shopCount,
    historicalRefundOnly: stats.historicalRefundOnly,
    signedOrderCount: stats.signedCount ?? 0,
    disputeOrderCount: disputeOrderCount(item),
    reasonText,
    suggestionText: buildSuggestionText(reasonText),
    mainShopName: shopAgg.mainShopName,
    shopLabel: formatShopLabelForWechat(shopAgg),
  }
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

export async function loadBadBuyerRankingAuditContext(
  preset: string,
  startDate?: string,
  endDate?: string,
): Promise<{
  views: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
  shopMap: Map<string, BuyerShopAggregate>
  aftersaleApplyByBuyer: Map<string, number>
}> {
  const range = resolveBuyerRankingDateRange(preset, startDate, endDate)
  const allAnalysisRange = buyerRankingRangeToAnalysisRange(
    resolveBuyerRankingDateRange('all'),
  )
  const bundle = await buildRawAnalyzeBundle(allAnalysisRange)
  if (!bundle) {
    return {
      views: [],
      rawByMatch: new Map(),
      shopMap: new Map(),
      aftersaleApplyByBuyer: new Map(),
    }
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const views = filterViewsForBuyerRanking(
    attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch),
  ).filter((v) => {
    const row = mapViewToBuyerOrderStandard(v)
    return (
      viewPayTimeInBuyerRankingRange(v, range) ||
      viewAfterSaleEventInBuyerRankingRange(v, range, row)
    )
  })
  return {
    views,
    rawByMatch,
    shopMap: buildBuyerShopMapFromViews(views),
    aftersaleApplyByBuyer: buildAftersaleApplyCountByBuyer(views),
  }
}

async function loadBadBuyerContextForRange(
  preset: string,
  startDate?: string,
  endDate?: string,
): Promise<{
  shopMap: Map<string, BuyerShopAggregate>
  aftersaleApplyByBuyer: Map<string, number>
}> {
  const ctx = await loadBadBuyerRankingAuditContext(preset, startDate, endDate)
  return {
    shopMap: ctx.shopMap,
    aftersaleApplyByBuyer: ctx.aftersaleApplyByBuyer,
  }
}

/** 高风险售后客户榜统一聚合：页面、微信文本、数据健康核对共用 */
export async function buildBadBuyerRankingEnrichedItems(params: {
  preset?: string
  startDate?: string
  endDate?: string
}): Promise<BadBuyerRankingItem[]> {
  const preset = params.preset ?? 'recent30'
  const items = await buildBadBuyerRankingAllItems({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
    type: 'all',
  })
  const ctx = await loadBadBuyerRankingAuditContext(preset, params.startDate, params.endDate)

  return items
    .filter(isBadBuyerCandidate)
    .map((item) => {
      const badBuyerProfile = buildBadBuyerProfile(item, ctx.shopMap.get(item.buyerKey), {
        aftersaleApplyCount: ctx.aftersaleApplyByBuyer.get(item.buyerKey),
      })
      return { ...item, badBuyerProfile }
    })
    .filter((item) =>
      isBadBuyerRefundStatsConsistent({
        refundOrderCount: item.badBuyerProfile.refundOrderCount,
        refundAmountCent: Math.round(item.badBuyerProfile.refundAmountYuan * 100),
      }),
    )
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

  const enriched = await buildBadBuyerRankingEnrichedItems({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })

  const enrichedSorted = [...enriched].sort(compareBadBuyerRankingItems).slice(0, limit)

  const presetLabel =
    BUYER_RANKING_PRESET_LABELS[range.preset as BuyerRankingPreset] ?? range.preset

  return {
    items: enrichedSorted,
    range: {
      preset: range.preset,
      presetLabel,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    limit,
    empty: enrichedSorted.length === 0,
    dataNote: '不按主播区分；所有主播共用同一份公司公共客户榜。',
  }
}

export function formatBadBuyerListDisplayName(
  buyerDisplayName: string,
  qualityRefundOrderCount: number,
): string {
  if (qualityRefundOrderCount > 0) return `【${buyerDisplayName}】`
  return buyerDisplayName
}

export function formatBadBuyerPaidLine(paidCount: number, historicalRefundOnly: boolean): string {
  if (historicalRefundOnly) return '支付：历史订单'
  return `本期支付：${paidCount} 单`
}

export function compareBadBuyerRankingItems(
  a: {
    badBuyerProfile: Pick<
      BadBuyerProfile,
      | 'qualityRefundOrderCount'
      | 'returnRefundOrderCount'
      | 'refundOrderCount'
      | 'refundAmountYuan'
      | 'aftersaleCount'
    >
  },
  b: {
    badBuyerProfile: Pick<
      BadBuyerProfile,
      | 'qualityRefundOrderCount'
      | 'returnRefundOrderCount'
      | 'refundOrderCount'
      | 'refundAmountYuan'
      | 'aftersaleCount'
    >
  },
): number {
  const qcDiff =
    b.badBuyerProfile.qualityRefundOrderCount - a.badBuyerProfile.qualityRefundOrderCount
  if (qcDiff !== 0) return qcDiff
  const rrDiff =
    b.badBuyerProfile.returnRefundOrderCount - a.badBuyerProfile.returnRefundOrderCount
  if (rrDiff !== 0) return rrDiff
  const refundOrderDiff =
    b.badBuyerProfile.refundOrderCount - a.badBuyerProfile.refundOrderCount
  if (refundOrderDiff !== 0) return refundOrderDiff
  const amountDiff =
    Math.round(b.badBuyerProfile.refundAmountYuan * 100) -
    Math.round(a.badBuyerProfile.refundAmountYuan * 100)
  if (amountDiff !== 0) return amountDiff
  return b.badBuyerProfile.aftersaleCount - a.badBuyerProfile.aftersaleCount
}

export function formatBadBuyerWechatBlock(row: BadBuyerWechatTextRow): string {
  const name = formatBadBuyerListDisplayName(row.buyerDisplayName, row.qualityRefundOrderCount)
  const lines = [
    `${row.rank}. ${name}`,
    `${row.paidLine}｜签收：${row.signedLine}｜签收率：${row.signedRateLabel}`,
    `本期退款：${row.refundOrderCount} 单｜退款金额：${formatMoneyYuanCompact(row.refundAmountYuan)}`,
    `品退：${row.qualityRefundOrderCount} 单｜退货退款：${row.returnRefundOrderCount} 单`,
    `店铺：${row.shopLabel}`,
  ]
  if (row.historicalRefundOnly) {
    lines.push('来源：历史订单本期售后/退款')
  }
  return lines.join('\n')
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
      paidLine: formatBadBuyerPaidLine(p.paidCount, p.historicalRefundOnly),
      historicalRefundOnly: p.historicalRefundOnly,
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
