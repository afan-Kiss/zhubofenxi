import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { getAnchorConfigSync } from './anchor.service'
import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'
import { centToYuan } from '../utils/money'
import {
  resolveBuyerRankingDateRange,
  buyerRankingRangeToAnalysisRange,
  type BuyerRankingPreset,
  BUYER_RANKING_PRESET_LABELS,
} from '../utils/buyer-ranking-date-range'
import {
  isHighValueBuyer,
  isRepurchaseBuyer,
  isAfterSaleHeavyBuyer,
  isQualityHeavyBuyer,
} from './buyer-ranking-classification'
import {
  buildBuyerDisplayLabel,
  pickBuyerNicknameFromView,
  resolveBuyerIdentityFromView,
  type BuyerIdentity,
  type BuyerIdentitySource,
} from './buyer-identity.service'
import {
  buildBuyerRankingTabSummary,
  filterBuyerRankingByTab,
} from './buyer-ranking-tab-filters'
import {
  buildBuyerOrderSummary,
  mapViewToBuyerOrderStandard,
  resolveBuyerOrderQualityRefund,
  type BuyerOrderSummary,
} from './buyer-order-standard.service'
import { formatDateTime, parseDateTime } from '../utils/time'
import { resolveDisplayEarnedAmountCent } from './buyer-earned-amount.service'
import {
  attachRawByMatchToViews,
  filterViewsForBuyerRanking,
} from './low-price-brush-order.service'

export type BuyerRankingType = 'all' | 'good' | 'risk'

export type BuyerRankingSortBy =
  | 'gmv'
  | 'netGmv'
  | 'signedAmount'
  | 'orderCount'
  | 'refundAmount'
  | 'refundRate'
  | 'qualityReturnCount'
  | 'riskScore'
  | 'lastOrderTime'

export type BuyerCustomerTag =
  | '优质客户'
  | '复购客户'
  | '售后偏多'
  | '品退'
  | '品退偏多'

export interface BuyerRankingItem {
  /** 买家唯一聚合键（查询 Drawer 必传） */
  buyerKey: string
  buyerId: string
  nickname: string
  buyerNickname?: string
  buyerDisplayName?: string
  buyerDisplayLabel?: string
  identitySource?: BuyerIdentitySource
  /** 买家识别码（后 6 位） */
  buyerIdentityCode?: string
  buyerShortCode?: string
  /** 成功退款且 refund_fee > 0 的次数 */
  refundCount?: number
  /** 有售后记录/状态的订单数 */
  afterSaleCount?: number
  orderCount: number
  paidOrderCount?: number
  receivableAmount?: number
  statPaidAmount?: number
  refundSource?: string
  signedOrderCount: number
  unsignedOrderCount: number
  completedOrderCount: number
  returnRefundCount: number
  refundOnlyCount: number
  freightRefundCount: number
  afterSaleClosedNoRefundCount: number
  gmv: number
  signedAmount: number
  productRefundAmount: number
  freightRefundAmount: number
  actualDealAmount: number
  /** 买家展示：赚到金额（元） */
  earnedAmount: number
  /** 买家展示：赚到金额（分） */
  displayEarnedAmountCent?: number
  qualityReturnCount: number
  qualityReturnAmount?: number
  lastQualityReturnReason?: string
  /** @deprecated 使用 afterSaleCount */
  refundRelatedOrderCount: number
  /** @deprecated 使用 refundCount */
  refundTimes: number
  /** 商品退款金额合计（与 productRefundAmount 相同） */
  refundAmount?: number
  sizeMismatchCount: number
  lastOrderTime: string
  customerTags: BuyerCustomerTag[]
  /** @deprecated use customerTags */
  customerTag: string
  isBlacklisted: boolean
  suggestion: string
  riskScore: number
  /** 与 Drawer 顶部、订单明细共用的标准化买家汇总 */
  buyerSummary?: BuyerOrderSummary
  /** 售后中/待同步订单数（不计入退款统计） */
  pendingAfterSaleOrderCount?: number
}

function applyIdentityDisplay(agg: BuyerAgg, identity: BuyerIdentity): void {
  if (identity.buyerNickname) agg.buyerNickname = identity.buyerNickname
  if (identity.buyerDisplayName && identity.buyerDisplayName !== '未知买家') {
    agg.buyerDisplayName = identity.buyerDisplayName
    agg.nickname = identity.buyerDisplayName
  }
  agg.buyerDisplayLabel = identity.buyerDisplayLabel
  agg.buyerShortCode = identity.buyerShortCode
}

function mergeViewNickname(agg: BuyerAgg, v: AnalyzedOrderView): void {
  const nick = pickBuyerNicknameFromView(v)
  if (!nick) return
  agg.buyerNickname = nick
  if (agg.buyerDisplayName === '未知买家' || !agg.buyerDisplayName) {
    agg.buyerDisplayName = nick
    agg.nickname = nick
    agg.buyerDisplayLabel = buildBuyerDisplayLabel(nick, agg.buyerShortCode)
  }
}

interface BuyerAgg {
  buyerKey: string
  buyerId: string
  nickname: string
  buyerNickname?: string
  buyerDisplayName: string
  buyerDisplayLabel: string
  buyerShortCode: string
  identitySource: BuyerIdentitySource
  orderCount: number
  paidOrderCount: number
  paymentBaseCent: number
  receivableAmountCent: number
  statPaidAmountCent: number
  signedOrderCount: number
  unsignedOrderCount: number
  completedOrderCount: number
  returnRefundCount: number
  refundOnlyCount: number
  freightRefundCount: number
  afterSaleClosedNoRefundCount: number
  signedAmountCent: number
  productRefundCent: number
  freightRefundCent: number
  effectiveGmvCent: number
  qualityReturnCount: number
  qualityReturnAmountCent: number
  lastQualityReturnReason: string
  /** @deprecated 调试字段，页面主统计请用 buyerSummary.refundOrderCount */
  refundCount: number
  /** @deprecated 调试字段，页面主统计勿用 */
  afterSaleCount: number
  sizeMismatchCount: number
  lastOrderTime: string
  anchors: Set<string>
  buyerSummary: BuyerOrderSummary
}

function viewIsUnpaid(v: AnalyzedOrderView): boolean {
  if (v.includedInGmv) return false
  return (v.gmvExcludeReason ?? '').includes('未支付')
}

function viewIsCancelled(v: AnalyzedOrderView): boolean {
  const text = v.orderStatusText ?? ''
  return ['已取消', '取消', '交易关闭', '已关闭'].some((k) => text.includes(k))
}

/** 买家画像：单笔订单是否计入退款/售后相关（比经营看板略严，避免普通有效订单误计） */
function buyerOrderProductRefundCent(v: AnalyzedOrderView): number {
  return v.buyerProductRefundAmountCent ?? 0
}

function orderCountsAsBuyerRefundRelated(v: AnalyzedOrderView): boolean {
  if (buyerOrderProductRefundCent(v) > 0) return true
  if (v.isReturnRefund || v.isRefundOnly || v.isRealProductRefund) return true
  if (v.afterSaleClosedNoRefund) return true
  if (v.isQualityReturn) return true
  if (viewIsCancelled(v) && v.includedInGmv) return true
  return false
}

function classifyBuyerTags(item: BuyerRankingItem): BuyerCustomerTag[] {
  const tags: BuyerCustomerTag[] = []
  if (isHighValueBuyer(item)) tags.push('优质客户')
  if (isRepurchaseBuyer(item)) tags.push('复购客户')
  if (isAfterSaleHeavyBuyer(item)) tags.push('售后偏多')
  if (isQualityHeavyBuyer(item)) tags.push('品退偏多')
  else if (item.qualityReturnCount >= 1) tags.push('品退')
  return tags
}

function buyerSuggestion(item: BuyerRankingItem): string {
  if (isQualityHeavyBuyer(item)) return '建议重点关注'
  if (item.qualityReturnCount >= 1) return '建议谨慎发货'
  if (isAfterSaleHeavyBuyer(item)) return '售后偏多'
  if (isHighValueBuyer(item)) return '优质客户'
  return '—'
}

function toItem(agg: BuyerAgg): BuyerRankingItem {
  const summary = agg.buyerSummary
  const orderCount = summary.orderCount
  const signedAmount = centToYuan(agg.signedAmountCent)
  const productRefundAmount = centToYuan(summary.refundAmountCent)
  const freightRefundAmount = centToYuan(agg.freightRefundCent)
  const actualDealAmount = centToYuan(summary.realDealAmountCent || summary.netDealAmountCent)
  const displayEarnedAmountCent = resolveDisplayEarnedAmountCent(summary)
  const earnedAmount = centToYuan(displayEarnedAmountCent)

  let riskScore = 0
  if (orderCount > 0) {
    riskScore += Math.min(40, (summary.refundOrderCount / orderCount) * 100)
    riskScore += Math.min(30, (summary.qualityRefundOrderCount / orderCount) * 100)
    if (summary.refundAmountCent > agg.paymentBaseCent * 0.5) riskScore += 20
  }

  const isBlacklisted = false

  const item: BuyerRankingItem = {
    buyerKey: agg.buyerKey,
    buyerId: agg.buyerId,
    nickname: agg.buyerDisplayName,
    buyerNickname: agg.buyerNickname ?? agg.buyerDisplayName,
    buyerDisplayName: agg.buyerDisplayName,
    buyerDisplayLabel: agg.buyerDisplayLabel,
    identitySource: agg.identitySource,
    buyerIdentityCode: agg.buyerShortCode,
    buyerShortCode: agg.buyerShortCode,
    isBlacklisted,
    orderCount,
    paidOrderCount: summary.paidOrderCount,
    receivableAmount: centToYuan(summary.receivableAmountCent),
    statPaidAmount: centToYuan(summary.payAmountCent),
    refundSource: 'after_sales_workbench',
    signedOrderCount: agg.signedOrderCount,
    unsignedOrderCount: agg.unsignedOrderCount,
    completedOrderCount: agg.completedOrderCount,
    returnRefundCount: summary.returnRefundOrderCount,
    refundOnlyCount: agg.refundOnlyCount,
    freightRefundCount: agg.freightRefundCount,
    afterSaleClosedNoRefundCount: agg.afterSaleClosedNoRefundCount,
    gmv: centToYuan(summary.payAmountCent),
    signedAmount,
    productRefundAmount,
    freightRefundAmount,
    actualDealAmount,
    earnedAmount,
    displayEarnedAmountCent,
    qualityReturnCount: summary.qualityRefundOrderCount,
    qualityReturnAmount: centToYuan(agg.qualityReturnAmountCent),
    lastQualityReturnReason: agg.lastQualityReturnReason || undefined,
    refundCount: summary.refundOrderCount,
    afterSaleCount: agg.afterSaleCount,
    refundRelatedOrderCount: agg.afterSaleCount,
    refundTimes: summary.refundOrderCount,
    refundAmount: productRefundAmount,
    sizeMismatchCount: agg.sizeMismatchCount,
    lastOrderTime: agg.lastOrderTime || '—',
    customerTags: [],
    customerTag: '',
    suggestion: '—',
    riskScore: Math.min(100, Math.round(riskScore)),
    buyerSummary: summary,
    pendingAfterSaleOrderCount: summary.pendingAfterSaleOrderCount,
  }
  item.customerTags = classifyBuyerTags(item)
  item.customerTag = item.customerTags[0] ?? '—'
  item.suggestion = buyerSuggestion(item)
  return item
}

function emptyBuyerSummary(): BuyerOrderSummary {
  return {
    receivableAmountCent: 0,
    payAmountCent: 0,
    refundAmountCent: 0,
    freightRefundAmountCent: 0,
    netDealAmountCent: 0,
    realDealAmountCent: 0,
    displayEarnedAmountCent: 0,
    orderCount: 0,
    paidOrderCount: 0,
    realDealOrderCount: 0,
    refundOrderCount: 0,
    qualityRefundOrderCount: 0,
    returnRefundOrderCount: 0,
    afterSaleOrderCount: 0,
    pendingAfterSaleOrderCount: 0,
  }
}

function aggregateViews(views: AnalyzedOrderView[]): BuyerAgg[] {
  const map = new Map<string, BuyerAgg & { standardRows: ReturnType<typeof mapViewToBuyerOrderStandard>[] }>()

  for (const v of views) {
    const identity = resolveBuyerIdentityFromView(v)
    if (!identity) continue

    let agg = map.get(identity.key)
    if (!agg) {
      agg = {
        buyerKey: identity.buyerKey,
        buyerId: identity.buyerId ?? identity.buyerKey,
        nickname: identity.buyerDisplayName,
        buyerNickname: identity.buyerNickname,
        buyerDisplayName: identity.buyerDisplayName,
        buyerDisplayLabel: identity.buyerDisplayLabel,
        buyerShortCode: identity.buyerShortCode,
        identitySource: identity.identitySource,
        orderCount: 0,
        paidOrderCount: 0,
        paymentBaseCent: 0,
        receivableAmountCent: 0,
        statPaidAmountCent: 0,
        signedOrderCount: 0,
        unsignedOrderCount: 0,
        completedOrderCount: 0,
        returnRefundCount: 0,
        refundOnlyCount: 0,
        freightRefundCount: 0,
        afterSaleClosedNoRefundCount: 0,
        signedAmountCent: 0,
        productRefundCent: 0,
        freightRefundCent: 0,
        effectiveGmvCent: 0,
        qualityReturnCount: 0,
        qualityReturnAmountCent: 0,
        lastQualityReturnReason: '',
        refundCount: 0,
        afterSaleCount: 0,
        sizeMismatchCount: 0,
        lastOrderTime: v.orderTimeText,
        anchors: new Set(),
        buyerSummary: emptyBuyerSummary(),
        standardRows: [],
      }
      map.set(identity.key, agg)
    }

    applyIdentityDisplay(agg, identity)
    mergeViewNickname(agg, v)
    agg.standardRows.push(mapViewToBuyerOrderStandard(v))

    if (!viewIsUnpaid(v)) {
      agg.orderCount += 1
    }
    const receivable =
      v.buyerReceivableAmountCent ??
      ((v.productAmountCent || 0) + (v.freightCent || 0) || v.receivableAmountCent || 0)
    agg.receivableAmountCent += receivable

    const officialPaid = v.officialPaidAmountCent ?? 0
    if (officialPaid > 0 && (v.officialPaidConfirmed ?? true)) {
      agg.statPaidAmountCent += officialPaid
      agg.paidOrderCount += 1
    }
    if (v.includedInGmv) {
      agg.paymentBaseCent += v.paymentBaseCent || 0
    }
    agg.effectiveGmvCent += v.effectiveGmvCent

    if (v.isEffectiveSigned) {
      agg.signedOrderCount += 1
      agg.signedAmountCent += v.actualSignAmountCent ?? v.actualSignedAmountCent
    } else if (v.isSigned || v.afterSaleClosedNoRefund) {
      agg.completedOrderCount += 1
    } else {
      agg.unsignedOrderCount += 1
    }

    if (v.isReturnRefund) agg.returnRefundCount += 1
    if (v.isRefundOnly && !v.isFreightRefundOnly) agg.refundOnlyCount += 1
    if (v.isFreightRefundOnly) agg.freightRefundCount += 1
    if (v.afterSaleClosedNoRefund) agg.afterSaleClosedNoRefundCount += 1
    if (buyerOrderProductRefundCent(v) > 0 && !v.isFreightRefundOnly) agg.refundCount += 1
    if (orderCountsAsBuyerRefundRelated(v) && !v.isFreightRefundOnly) agg.afterSaleCount += 1
    agg.productRefundCent += buyerOrderProductRefundCent(v)
    agg.freightRefundCent += v.freightRefundAmountCent
    const qualityRefund = resolveBuyerOrderQualityRefund(v)
    if (qualityRefund.isQualityRefund) {
      agg.qualityReturnCount += 1
      if (v.strictQualityRefund === true) {
        agg.qualityReturnAmountCent += buyerOrderProductRefundCent(v)
      }
      const reason = (qualityRefund.qualityRefundReasonMatched || v.afterSalesWorkbenchReason || v.reasonText || '').trim()
      if (reason) agg.lastQualityReturnReason = reason
    }
    if (v.isSizeMismatch) agg.sizeMismatchCount += 1
    if (v.anchorName) agg.anchors.add(v.anchorName)
    if (v.orderTimeText && v.orderTimeText > agg.lastOrderTime) {
      agg.lastOrderTime = v.orderTimeText
    }
  }

  for (const agg of map.values()) {
    agg.buyerSummary = buildBuyerOrderSummary(agg.standardRows)
  }

  return [...map.values()].map(({ standardRows: _rows, ...agg }) => agg)
}

function sortItems(
  items: BuyerRankingItem[],
  sortBy: BuyerRankingSortBy,
  sortOrder: 'asc' | 'desc',
): void {
  const dir = sortOrder === 'asc' ? 1 : -1
  items.sort((a, b) => {
    let cmp = 0
    switch (sortBy) {
      case 'gmv':
      case 'netGmv':
        cmp =
          (a.buyerSummary?.netDealAmountCent ?? a.actualDealAmount * 100) -
          (b.buyerSummary?.netDealAmountCent ?? b.actualDealAmount * 100)
        break
      case 'signedAmount':
        cmp = a.signedAmount - b.signedAmount
        break
      case 'orderCount':
        cmp = a.orderCount - b.orderCount
        break
      case 'refundAmount':
        cmp = a.productRefundAmount - b.productRefundAmount
        break
      case 'refundRate':
        cmp =
          (a.orderCount ? (a.returnRefundCount + a.refundOnlyCount) / a.orderCount : 0) -
          (b.orderCount ? (b.returnRefundCount + b.refundOnlyCount) / b.orderCount : 0)
        break
      case 'qualityReturnCount':
        cmp = a.qualityReturnCount - b.qualityReturnCount
        break
      case 'riskScore':
        cmp = a.riskScore - b.riskScore
        break
      case 'lastOrderTime':
        cmp = a.lastOrderTime.localeCompare(b.lastOrderTime)
        break
      default:
        cmp = a.signedAmount - b.signedAmount
    }
    return cmp * dir
  })
}

export type BuyerRankingTab = 'spend' | 'repurchase' | 'refund' | 'quality' | 'blacklist'

function filterByRankingTab(items: BuyerRankingItem[], tab?: string): BuyerRankingItem[] {
  return filterBuyerRankingByTab(items, tab)
}

function filterByType(items: BuyerRankingItem[], type: BuyerRankingType): BuyerRankingItem[] {
  if (type === 'good') {
    return items.filter(
      (i) =>
        i.customerTags.includes('优质客户') ||
        i.customerTags.includes('复购客户'),
    )
  }
  if (type === 'risk') {
    return items.filter((i) => i.isBlacklisted || i.customerTags.includes('售后偏多'))
  }
  return items
}

/** 返回当前范围内全部买家（不分页），供汇总钻取使用 */
export function buildBuyerRankingSummaryFromViews(
  views: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>,
): {
  items: BuyerRankingItem[]
  summary: {
    highValueCount: number
    repurchaseCount: number
    refundCount: number
    qualityHeavyCount: number
    blacklistCount: number
  }
} {
  const filtered = filterViewsForBuyerRanking(views)
  const aggs = aggregateViews(filtered)
  const items = aggs.map((a) => toItem(a))
  return {
    items,
    summary: buildBuyerRankingTabSummary(items),
  }
}

export async function buildBuyerRankingAllItems(
  params: Omit<Parameters<typeof buildBuyerRanking>[0], 'page' | 'pageSize'>,
): Promise<BuyerRankingItem[]> {
  const range = resolveBuyerRankingDateRange(
    params.preset ?? 'today',
    params.startDate,
    params.endDate,
  )
  const analysisRange = buyerRankingRangeToAnalysisRange(range)
  const bundle = await buildRawAnalyzeBundle(analysisRange)
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  let views = filterViewsForBuyerRanking(
    attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch),
  )
  if (params.anchorName) {
    views = views.filter((v) => v.anchorName === params.anchorName)
  } else if (params.anchorId) {
    const cfg = getAnchorConfigSync()
    const anchor = cfg.anchors.find((a) => a.id === params.anchorId)
    if (anchor) {
      views = views.filter((v) => v.anchorName === anchor.name || v.anchorId === anchor.id)
    }
  }
  let items = aggregateViews(views).map((a) => toItem(a))
  return filterByType(items, params.type ?? 'all')
}

export async function buildBuyerRanking(params: {
  preset?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
  sortBy?: BuyerRankingSortBy
  sortOrder?: 'asc' | 'desc'
  type?: BuyerRankingType
  anchorName?: string
  anchorId?: string
  rankingTab?: string
}): Promise<{
  page: number
  pageSize: number
  total: number
  totalPages: number
  items: BuyerRankingItem[]
  range: {
    preset: string
    presetLabel: string
    startDate: string
    endDate: string
  }
  dataNote: string
  orderCountInRange: number
  summary: {
    highValueCount: number
    repurchaseCount: number
    refundCount: number
    qualityHeavyCount: number
    blacklistCount: number
  }
}> {
  const range = resolveBuyerRankingDateRange(
    params.preset ?? 'today',
    params.startDate,
    params.endDate,
  )

  const analysisRange = buyerRankingRangeToAnalysisRange(range)
  const bundle = await buildRawAnalyzeBundle(analysisRange)
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  let views = filterViewsForBuyerRanking(
    attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch),
  )

  if (params.anchorName) {
    views = views.filter((v) => v.anchorName === params.anchorName)
  } else if (params.anchorId) {
    const cfg = getAnchorConfigSync()
    const anchor = cfg.anchors.find((a) => a.id === params.anchorId)
    if (anchor) {
      views = views.filter((v) => v.anchorName === anchor.name || v.anchorId === anchor.id)
    }
  }

  const aggs = aggregateViews(views)
  let items = aggs.map((a) => toItem(a))
  items = filterByRankingTab(items, params.rankingTab)
  items = filterByType(items, params.type ?? 'all')

  const sortBy = params.sortBy ?? 'netGmv'
  const sortOrder = params.sortOrder ?? 'desc'
  sortItems(items, sortBy, sortOrder)

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const allForSummary = aggs.map((a) => toItem(a))
  const summary = buildBuyerRankingTabSummary(allForSummary)
  const slice = items.slice((page - 1) * pageSize, page * pageSize)

  const presetLabel =
    BUYER_RANKING_PRESET_LABELS[range.preset as BuyerRankingPreset] ?? range.preset

  return {
    page,
    pageSize,
    total,
    totalPages,
    items: slice,
    range: {
      preset: range.preset,
      presetLabel,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    dataNote: '签收/退货/运费补偿按统一售后口径统计',
    orderCountInRange: views.length,
    summary,
  }
}

export interface BuyerRankingSampleMeta {
  lastUpdatedAt: string | null
  sampleOrderCount: number
  sampleCustomerCount: number
  sampleStartTime: string | null
  sampleEndTime: string | null
  sampleTimeField: 'payTime'
  sampleDescription: string
}

function orderNoFromBuyerView(v: AnalyzedOrderView): string {
  return (v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId || '').trim()
}

function buyerKeyFromBuyerView(v: AnalyzedOrderView): string {
  return (v.buyerKey || v.buyerId || '').trim()
}

export function buildBuyerRankingSampleMetaFromViews(
  views: AnalyzedOrderView[],
  lastUpdatedAt: string | null,
  orders?: NormalizedOrder[],
): BuyerRankingSampleMeta {
  const orderNos = new Set<string>()
  const buyerKeys = new Set<string>()
  let minPayMs = Infinity
  let maxPayMs = -Infinity

  for (const v of views) {
    const no = orderNoFromBuyerView(v)
    if (no) orderNos.add(no)
    const bk = buyerKeyFromBuyerView(v)
    if (bk) buyerKeys.add(bk)
    const parsed = parseDateTime(v.orderTimeText)
    if (parsed.ok && parsed.date) {
      const ms = parsed.date.getTime()
      if (ms < minPayMs) minPayMs = ms
      if (ms > maxPayMs) maxPayMs = ms
    }
  }

  if (orders?.length && orderNos.size > 0) {
    for (const o of orders) {
      const no = String(o.packageId ?? o.orderId ?? '').trim()
      if (!no || !orderNos.has(no)) continue
      const pt = o.paymentTime
      if (!(pt instanceof Date) || Number.isNaN(pt.getTime())) continue
      const ms = pt.getTime()
      if (ms < minPayMs) minPayMs = ms
      if (ms > maxPayMs) maxPayMs = ms
    }
  }

  return {
    lastUpdatedAt,
    sampleOrderCount: orderNos.size,
    sampleCustomerCount: buyerKeys.size,
    sampleStartTime: Number.isFinite(minPayMs) ? formatDateTime(new Date(minPayMs)) : null,
    sampleEndTime: Number.isFinite(maxPayMs) ? formatDateTime(new Date(maxPayMs)) : null,
    sampleTimeField: 'payTime',
    sampleDescription:
      '按订单支付时间统计，未支付订单不计入核心金额，客户按买家ID去重。单价低于 ¥20.00 的低价刷单订单已自动排除。',
  }
}
