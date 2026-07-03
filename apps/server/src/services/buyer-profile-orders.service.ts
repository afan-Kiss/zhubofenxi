import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { viewMatchesBuyerKey } from './buyer-identity.service'
import type { BuyerRankingItem } from './buyer-ranking.service'
import {
  buildBuyerOrderFilterSummary,
  buildBuyerOrderSummary,
  buildBuyerOrderTabs,
  buyerOrderTabEmptyText,
  filterBuyerOrdersByTab,
  mapViewToBuyerOrderStandard,
  normalizeBuyerOrderTabKey,
  type BuyerOrderStandardRow,
  type BuyerOrderSummary,
  type BuyerOrderTabKey,
} from './buyer-order-standard.service'
import {
  attachRawByMatchToViews,
  filterViewsForBuyerRanking,
} from './low-price-brush-order.service'

export interface BuyerDrawerAuditMetrics {
  summary: BuyerOrderSummary
  signedOrderCount: number
  completedOrderCount: number
  afterSaleCount: number
  sampleOrderIds: string[]
}

function buyerOrderProductRefundCent(v: AnalyzedOrderView): number {
  return v.buyerProductRefundAmountCent ?? 0
}

function orderCountsAsBuyerRefundRelated(v: AnalyzedOrderView): boolean {
  if (buyerOrderProductRefundCent(v) > 0) return true
  if (v.isReturnRefund || v.isRefundOnly || v.isRealProductRefund) return true
  if (v.afterSaleClosedNoRefund) return true
  if (v.isQualityReturn) return true
  if (v.includedInGmv && /取消|关闭/.test(v.orderStatusText ?? '')) return true
  return false
}

/** 与 Drawer / buyer-profile orders 同口径：从订单明细 rows 汇总 */
export function buildBuyerDrawerAuditMetrics(params: {
  buyerKey: string
  allViews: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
}): BuyerDrawerAuditMetrics {
  const buyerKey = params.buyerKey.trim()
  const buyerViews = params.allViews.filter((v) => viewMatchesBuyerKey(v, buyerKey))
  const rankingViews = filterViewsForBuyerRanking(
    attachRawByMatchToViews(buyerViews, params.rawByMatch),
  )
  const rows = rankingViews.map((v) => mapViewToBuyerOrderStandard(v))
  const summary = buildBuyerOrderSummary(rows)

  let signedOrderCount = 0
  let completedOrderCount = 0
  let afterSaleCount = 0
  for (const v of rankingViews) {
    if (v.isEffectiveSigned) {
      signedOrderCount += 1
    } else if (v.isSigned || v.afterSaleClosedNoRefund) {
      completedOrderCount += 1
    }
    if (orderCountsAsBuyerRefundRelated(v) && !v.isFreightRefundOnly) {
      afterSaleCount += 1
    }
  }

  return {
    summary,
    signedOrderCount,
    completedOrderCount,
    afterSaleCount,
    sampleOrderIds: rows.slice(0, 5).map((r) => r.orderNo).filter(Boolean),
  }
}

export interface BadBuyerDrawerAuditMetrics {
  qualityRefundOrderCount: number
  returnRefundOrderCount: number
  aftersaleCount: number
  refundAmountCent: number
  refundOrderCount: number
  paidCount: number
  refundRate: number
  sampleOrderIds: string[]
}

function countAftersaleAppliesForRow(row: BuyerOrderStandardRow, v: AnalyzedOrderView): number {
  if (v.isFreightRefundOnly) return 0
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

/** 高风险售后客户 Drawer 口径：从订单明细逐单计算 */
export function buildBadBuyerDrawerAuditMetrics(params: {
  buyerKey: string
  allViews: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
}): BadBuyerDrawerAuditMetrics {
  const buyerKey = params.buyerKey.trim()
  const buyerViews = params.allViews.filter((v) => viewMatchesBuyerKey(v, buyerKey))
  const rankingViews = filterViewsForBuyerRanking(
    attachRawByMatchToViews(buyerViews, params.rawByMatch),
  )
  const rows = rankingViews.map((v) => mapViewToBuyerOrderStandard(v))
  const summary = buildBuyerOrderSummary(rows)

  const returnRefundOrderCount = new Set(
    rows.filter((r) => r.afterSaleType === 'return_refund').map((r) => r.orderNo),
  ).size

  let aftersaleCount = 0
  for (let i = 0; i < rankingViews.length; i += 1) {
    aftersaleCount += countAftersaleAppliesForRow(rows[i]!, rankingViews[i]!)
  }

  const paidCount = summary.paidOrderCount
  const refundOrderCount = summary.refundOrderCount
  const refundRate = paidCount > 0 ? Math.min(refundOrderCount / paidCount, 1) : 0

  return {
    qualityRefundOrderCount: summary.qualityRefundOrderCount,
    returnRefundOrderCount,
    aftersaleCount,
    refundAmountCent: summary.refundAmountCent,
    refundOrderCount,
    paidCount,
    refundRate,
    sampleOrderIds: rows.slice(0, 5).map((r) => r.orderNo).filter(Boolean),
  }
}

function sortBuyerOrderRows(rows: BuyerOrderStandardRow[], sort: string): BuyerOrderStandardRow[] {
  const list = [...rows]
  if (sort === 'amount_desc') {
    list.sort((a, b) => b.payAmountCent - a.payAmountCent)
  } else {
    list.sort((a, b) => b.orderTime.localeCompare(a.orderTime))
  }
  return list
}

function summaryToLegacyStats(
  summary: BuyerOrderSummary,
  buyer: {
    buyerKey: string
    buyerId?: string
    nickname: string
    buyerDisplayName?: string
    buyerDisplayLabel?: string
    buyerShortCode?: string
    buyerIdentityCode?: string
    identitySource?: string
    isBlacklisted?: boolean
  },
): BuyerRankingItem {
  return {
    buyerKey: buyer.buyerKey,
    buyerId: buyer.buyerId ?? buyer.buyerKey,
    nickname: buyer.nickname,
    buyerDisplayName: buyer.buyerDisplayName ?? buyer.nickname,
    buyerDisplayLabel: buyer.buyerDisplayLabel ?? buyer.nickname,
    buyerShortCode: buyer.buyerShortCode,
    buyerIdentityCode: buyer.buyerIdentityCode,
    identitySource: buyer.identitySource as BuyerRankingItem['identitySource'],
    orderCount: summary.orderCount,
    paidOrderCount: summary.paidOrderCount,
    receivableAmount: centToYuan(summary.receivableAmountCent),
    statPaidAmount: centToYuan(summary.payAmountCent),
    gmv: centToYuan(summary.payAmountCent),
    productRefundAmount: centToYuan(summary.refundAmountCent),
    refundAmount: centToYuan(summary.refundAmountCent),
    refundCount: summary.refundOrderCount,
    refundTimes: summary.refundOrderCount,
    qualityReturnCount: summary.qualityRefundOrderCount,
    signedOrderCount: 0,
    unsignedOrderCount: 0,
    completedOrderCount: 0,
    returnRefundCount: 0,
    refundOnlyCount: 0,
    freightRefundCount: 0,
    afterSaleClosedNoRefundCount: 0,
    signedAmount: 0,
    freightRefundAmount: centToYuan(summary.freightRefundAmountCent),
    actualDealAmount: centToYuan(summary.realDealAmountCent || summary.netDealAmountCent),
    displayEarnedAmountCent: summary.displayEarnedAmountCent,
    earnedAmount: centToYuan(summary.displayEarnedAmountCent),
    refundRelatedOrderCount: summary.refundOrderCount,
    afterSaleCount: summary.pendingAfterSaleOrderCount,
    sizeMismatchCount: 0,
    lastOrderTime: '—',
    customerTags: [],
    customerTag: '—',
    isBlacklisted: buyer.isBlacklisted ?? false,
    suggestion: '—',
    riskScore: 0,
    buyerSummary: summary,
    pendingAfterSaleOrderCount: summary.pendingAfterSaleOrderCount,
  }
}

export interface BuyerProfileOrdersResult {
  buyer: {
    buyerKey: string
    buyerNickname: string
    buyerDisplayId: string
    buyerDisplayName?: string
    buyerDisplayLabel?: string
    identitySource?: string
  }
  summary: BuyerOrderSummary
  tabs: Array<{ key: BuyerOrderTabKey; label: string; count: number; emptyText: string }>
  currentFilterSummary: BuyerOrderSummary & { tab: BuyerOrderTabKey }
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: BuyerOrderStandardRow[]
  emptyText: string
  /** 全量累计统计（与 summary 相同，供前端固定顶部卡片） */
  buyerSummary: BuyerOrderSummary
  /** @deprecated 兼容旧前端 stats 字段，始终为全量累计 */
  stats: BuyerRankingItem
}

export function buildBuyerProfileOrdersResponse(params: {
  buyerKey: string
  allViews: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
  cachedStats?: BuyerRankingItem | null
  page?: number
  pageSize?: number
  sort?: string
  tab?: string
}): BuyerProfileOrdersResult {
  const buyerKey = params.buyerKey.trim()
  const tabKey = normalizeBuyerOrderTabKey(params.tab)

  const buyerViews = params.allViews.filter((v) => viewMatchesBuyerKey(v, buyerKey))
  const rankingViews = filterViewsForBuyerRanking(
    attachRawByMatchToViews(buyerViews, params.rawByMatch),
  )

  const allRows = rankingViews.map((v) => mapViewToBuyerOrderStandard(v))

  const buyerSummary = buildBuyerOrderSummary(allRows)
  const tabs = buildBuyerOrderTabs(allRows)
  const filtered = filterBuyerOrdersByTab(allRows, tabKey)
  const sorted = sortBuyerOrderRows(filtered, params.sort ?? 'time_desc')
  const currentFilterSummary = {
    tab: tabKey,
    ...buildBuyerOrderFilterSummary(filtered, tabKey),
  }

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = sorted.length
  const rows = sorted.slice((page - 1) * pageSize, page * pageSize)

  const cached = params.cachedStats
  const displayName =
    cached?.buyerDisplayName ?? cached?.nickname ?? allRows[0]?.buyerNickname ?? buyerKey
  const buyerMeta = {
    buyerKey,
    buyerId: cached?.buyerId,
    nickname: displayName,
    buyerDisplayName: displayName,
    buyerDisplayLabel: cached?.buyerDisplayLabel ?? displayName,
    buyerShortCode: cached?.buyerShortCode ?? cached?.buyerIdentityCode ?? allRows[0]?.buyerDisplayId,
    buyerIdentityCode: cached?.buyerIdentityCode ?? allRows[0]?.buyerDisplayId,
    identitySource: cached?.identitySource,
    isBlacklisted: cached?.isBlacklisted,
  }

  return {
    buyer: {
      buyerKey,
      buyerNickname: displayName,
      buyerDisplayId: buyerMeta.buyerShortCode ?? allRows[0]?.buyerDisplayId ?? '—',
      buyerDisplayName: displayName,
      buyerDisplayLabel: buyerMeta.buyerDisplayLabel,
      identitySource: buyerMeta.identitySource,
    },
    summary: buyerSummary,
    buyerSummary,
    tabs,
    currentFilterSummary,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    rows,
    emptyText: buyerOrderTabEmptyText(tabKey),
    stats: summaryToLegacyStats(buyerSummary, buyerMeta),
  }
}
