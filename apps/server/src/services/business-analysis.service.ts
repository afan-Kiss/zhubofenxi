import type {
  AnchorConfig,
  AnchorSummary,
  AnalyzedOrderView,
  BusinessAnalysisResult,
  BusinessOverview,
  BuyerPaymentRankItem,
  BuyerQualityReturnRankItem,
  BuyerReturnRankItem,
  ExcelParseResult,
  FieldMappingResult,
  LiveSession,
  NormalizedOrder,
  ReturnDetailItem,
  SettlementPreprocessResult,
  SettlementRecord,
} from '../types/analysis'
import type { AbnormalOrderItem, UnassignedOrderItem } from '../types/analysis'

export type { BusinessAnalysisResult } from '../types/analysis'
import { computeAnalysisRange } from './analysis-range.service'
import { attributeOrders } from './order-attribution.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  computeGrossProfitBreakdown,
  grossProfitToDisplay,
} from './gross-profit.service'
import { dedupeOrders } from './order-deduper.service'
import { normalizeLiveSessions } from './live-session.service'
import { normalizeOrders } from './order-normalizer.service'
import {
  buildSettlementMaps,
  preprocessSettlement,
  preprocessSettlementFromRecords,
  sumSettlementDirection,
} from './reconcile.service'
import { sumCent } from '../utils/money'
import {
  computeOrderAmountMetrics,
  pickBuyerReceivableAmountCent,
  sumEffectiveGmvCent,
} from './order-amount-metrics.service'
import { resolveOfficialPaidAmountCent } from './resolve-official-paid-amount.service'
import { classifyOrderAfterSale } from './after-sale-classification.service'
import type { AfterSaleOrderAggregate } from './xhs-after-sales-range.service'
import { isStatusSignedOrder } from './order-sign-status.service'
import { computeStrictOrderViewFields } from './strict-after-sale-metrics.service'
import {
  buildBuyerDisplayFields,
  pickBuyerNicknameFromRaw,
} from './buyer-identity.service'
import {
  bootstrapWorkbenchCache,
  buildLiveAccountOrderQueries,
  getWorkbenchRefundMapForOrders,
} from './xhs-after-sales-workbench.service'
import {
  getMatchedOfficialQualityCasesByPackage,
  getQualityBadCasesSync,
} from './quality-badcase-store.service'
import { applyOfficialQualityToView, resolveQualityRefundInfo } from './quality-refund-resolution.service'
import { resolveOrderProductRefund } from './order-product-refund.service'
import { isShopOrInvalidAnchorLabel } from '../utils/anchor-label'
import {
  liveAccountOrderKey,
  liveAccountPackageKey,
} from '../utils/live-account-cache-key.util'
import type { DateRangeResolved } from '../utils/date-range'
import { aggregateSuccessfulRefundCentInRange } from './strict-after-sale-metrics.service'
import {
  filterPrimaryOrdersForMetrics,
  warnPrimaryOrderIntegrity,
} from './order-primary-source.service'
import {
  abnormalOrderDisplayNo,
  partitionOrdersByResolvableTime,
} from './order-time-resolver.service'

export interface AnalyzeInput {
  order: { parsed: ExcelParseResult; mapping: FieldMappingResult }
  live?: { parsed: ExcelParseResult; mapping: FieldMappingResult }
  pending?: { parsed: ExcelParseResult; mapping: FieldMappingResult }
  settled?: { parsed: ExcelParseResult; mapping: FieldMappingResult }
  hasPendingFile: boolean
  hasSettledFile: boolean
  warnings: string[]
}

export interface AnalysisArtifacts {
  dedupe: import('../types/analysis').OrderDedupeResult
  views: AnalyzedOrderView[]
  settlement: import('../types/analysis').SettlementPreprocessResult | undefined
  liveSessions: import('../types/analysis').LiveSession[]
  warnings: string[]
  abnormalOrderCount?: number
  abnormalOrderNos?: string[]
}

function buildViews(
  uniqueOrders: NormalizedOrder[],
  attributions: ReturnType<typeof attributeOrders>,
  refundByOrder: Map<string, number>,
  hasReasonField: boolean,
  workbenchByOrderNo: Map<
    string,
    import('./xhs-after-sales-workbench.service').AfterSalesWorkbenchRefund
  >,
  afterSaleByOrderNo?: Map<string, AfterSaleOrderAggregate>,
  rawAfterSalesByOrderNo?: Map<string, Record<string, unknown>[]>,
  statRange?: DateRangeResolved,
): AnalyzedOrderView[] {
  const views: AnalyzedOrderView[] = []
  const officialByPackage = getMatchedOfficialQualityCasesByPackage(getQualityBadCasesSync())

  for (const o of uniqueOrders) {
    const attr = attributions.get(o.sourceRowIndex) ?? {
      anchorId: '',
      anchorName: '未归属',
      attributionType: 'unassigned' as const,
    }

    const settlementRefundCent = refundByOrder.get(o.matchOrderId) ?? 0

    const displayNo = (o.displayOrderNo || o.officialOrderNo || '').trim()
    const accountCacheKey = displayNo ? liveAccountOrderKey(o.liveAccountId, displayNo) : ''
    const workbench = accountCacheKey ? workbenchByOrderNo.get(accountCacheKey) : undefined
    const afterSaleAgg = accountCacheKey ? afterSaleByOrderNo?.get(accountCacheKey) : undefined
    const workbenchReason =
      workbench?.afterSaleReason?.trim() || afterSaleAgg?.reasons[0] || undefined

    const classification = classifyOrderAfterSale(
      o,
      workbench?.officialRefundAmountCent ?? settlementRefundCent,
      {
        afterSaleReasonText: workbenchReason,
        workbenchFreightRefundCent: workbench?.freightRefundAmountCent,
        workbenchHasFreightOnly: workbench?.hasFreightOnlyRefund,
      },
    )

    const metrics = computeOrderAmountMetrics(o, classification)
    const officialPaid = resolveOfficialPaidAmountCent(o)
    const buyerReceivableAmountCent = pickBuyerReceivableAmountCent(o)
    const boardRefundResolved = resolveOrderProductRefund(
      o,
      classification,
      settlementRefundCent,
      workbench,
    )
    const buyerRefundResolved = resolveOrderProductRefund(
      o,
      classification,
      settlementRefundCent,
      workbench,
      { buyerStrict: true },
    )
    const returnAmountCent =
      classification.productRefundAmountCent + classification.freightRefundAmountCent

    const afterSaleRecords = accountCacheKey
      ? rawAfterSalesByOrderNo?.get(accountCacheKey) ?? []
      : []
    let boardRefundCent = boardRefundResolved.productRefundAmountCent
    if (afterSaleAgg && afterSaleAgg.refundAmountCent > 0) {
      boardRefundCent = afterSaleAgg.refundAmountCent
    }
    const strictFields = computeStrictOrderViewFields({
      order: o,
      includedInGmv: metrics.includedInGmv,
      paymentBaseCent: metrics.paymentBaseCent,
      boardRefundAmountCent: boardRefundCent,
      afterSaleRecords,
      isFreightRefundOnly: classification.isFreightRefundOnly,
      freightRefundAmountCent: classification.freightRefundAmountCent,
      afterSaleClosedNoRefund: classification.afterSaleClosedNoRefund,
      resolvedRefundSource: boardRefundResolved.refundAmountSource,
    })
    const statRangeRefundAmountCent =
      statRange != null
        ? aggregateSuccessfulRefundCentInRange(afterSaleRecords, statRange)
        : undefined

    const orderRaw = o.raw as Record<string, unknown>
    const buyerKeyFromRaw =
      orderRaw._buyerKey != null ? String(orderRaw._buyerKey).trim() : ''
    const buyerNickname = pickBuyerNicknameFromRaw(orderRaw) || undefined
    const displayFields = buyerKeyFromRaw
      ? buildBuyerDisplayFields(
          buyerKeyFromRaw,
          orderRaw,
          orderRaw._buyerOfficialId != null ? String(orderRaw._buyerOfficialId) : null,
        )
      : null

    let view: AnalyzedOrderView = {
      orderId: o.matchOrderId,
      packageId: o.packageId,
      bizOrderId: o.bizOrderId,
      displayOrderNo: o.displayOrderNo || o.officialOrderNo,
      officialOrderNo: o.officialOrderNo || o.displayOrderNo,
      matchOrderId: o.matchOrderId,
      orderTimeText: o.orderTimeText,
      buyerId: o.buyerId,
      anchorId: attr.anchorId,
      anchorName: attr.anchorName,
      liveAccountId: o.liveAccountId,
      liveAccountName: o.liveAccountName,
      attributionType: attr.attributionType,
      matchedRuleName: attr.matchedRuleName,
      matchedLiveStartTime: attr.matchedLiveStartTime,
      matchedLiveEndTime: attr.matchedLiveEndTime,
      gmvCent: o.gmvCent,
      productAmountCent: o.productAmountCent,
      receivableAmountCent: o.receivableAmountCent,
      freightCent: o.freightCent,
      platformDiscountCent: o.platformDiscountCent,
      actualPaidCent: o.actualPaidCent,
      actualSellerReceiveAmountCent: o.actualSellerReceiveAmountCent,
      actualSignedAmountCent: strictFields.actualSignAmountCent,
      orderStatusText: o.orderStatusText,
      afterSaleStatusText: o.afterSaleStatusText,
      isSigned: o.isSigned,
      isReturned: classification.countsAsProductRefund || classification.countsAsReturnRefund,
      isActualSigned: strictFields.isEffectiveSigned,
      statusSigned: isStatusSignedOrder(o),
      isReturnRefundOrder: Boolean(afterSaleAgg?.hasReturnRefund),
      isQualityReturn: false,
      strictQualityRefund: strictFields.strictQualityRefund,
      hasHistoricalQualityReason: strictFields.hasHistoricalQualityReason,
      actualSignAmountCent: strictFields.actualSignAmountCent,
      successfulRefundAmountCent: strictFields.successfulRefundAmountCent,
      isEffectiveSigned: strictFields.isEffectiveSigned,
      finalAfterSaleReason: strictFields.finalAfterSaleReason || undefined,
      finalAfterSaleStatus: strictFields.finalAfterSaleStatus || undefined,
      returnAmountCent,
      productRefundAmountCent: strictFields.successfulRefundAmountCent || boardRefundCent,
      buyerProductRefundAmountCent: buyerRefundResolved.productRefundAmountCent,
      buyerProductRefundSource: buyerRefundResolved.refundAmountSource,
      buyerProductRefundAmountWarning: buyerRefundResolved.refundAmountWarning,
      afterSalesWorkbenchRefundAmountCent:
        boardRefundResolved.afterSalesWorkbenchRefundAmountCent ??
        buyerRefundResolved.afterSalesWorkbenchRefundAmountCent,
      refundIncludesFreight: buyerRefundResolved.refundIncludesFreight,
      freightRefundAmountCent: classification.freightRefundAmountCent,
      realAfterSaleAmountCent: classification.realAfterSaleAmountCent,
      isFreightRefundOnly: classification.isFreightRefundOnly,
      afterSaleClosedNoRefund: classification.afterSaleClosedNoRefund,
      isReturnRefund: classification.isReturnRefund,
      isRefundOnly: classification.isRefundOnly,
      isRealProductRefund: classification.isRealProductRefund,
      afterSaleCategory: classification.category,
      afterSaleStatusLabel: classification.afterSaleStatusLabel,
      afterSaleDisplayType: classification.afterSaleDisplayType,
      isSizeMismatch: classification.countsAsSizeMismatch,
      returnAmountWarning: buyerRefundResolved.refundAmountWarning,
      afterSalesWorkbenchReason: workbench?.afterSaleReason?.trim() || undefined,
      reasonText:
        workbench?.afterSaleReason?.trim() || classification.reasonRaw || o.reasonText,
      effectiveGmvCent: metrics.effectiveGmvCent,
      paymentBaseCent: metrics.paymentBaseCent,
      paymentBaseSource: metrics.paymentBaseSource,
      includedInGmv: metrics.includedInGmv,
      countsForSigned: metrics.countsForSigned,
      countsForGrossProfit: metrics.countsForGrossProfit,
      gmvExcludeReason: metrics.gmvExcludeReason,
      statPaidAmountCent: metrics.includedInGmv ? metrics.paymentBaseCent : 0,
      officialPaidAmountCent: officialPaid.cent,
      officialPaidAmountSource: officialPaid.source,
      officialPaidConfirmed: officialPaid.confirmed,
      buyerReceivableAmountCent,
      buyerKey: buyerKeyFromRaw || undefined,
      buyerNickname,
      buyerDisplayName: displayFields?.buyerDisplayName,
      buyerDisplayLabel: displayFields?.buyerDisplayLabel,
      buyerShortCode: displayFields?.buyerShortCode,
      statRangeRefundAmountCent,
    }
    const packageCacheKey = displayNo ? liveAccountPackageKey(o.liveAccountId, displayNo) : ''
    if (packageCacheKey && officialByPackage.has(packageCacheKey)) {
      view = applyOfficialQualityToView(view, officialByPackage.get(packageCacheKey)!)
    }
    const officialPackageIds = new Set(officialByPackage.keys())
    const officialCase = packageCacheKey ? officialByPackage.get(packageCacheKey)?.[0] : undefined
    const qualityInfo = resolveQualityRefundInfo({
      view,
      afterSaleRecords,
      matchedOfficialPackageIds: officialPackageIds,
      officialCase,
      verifySource: 'after_sale_time_search',
    })
    view.isQualityReturn = qualityInfo.isQualityRefund
    view.qualitySource = qualityInfo.qualitySource
    view.qualityMainSource = qualityInfo.qualityMainSource
    view.qualityVerifySource = qualityInfo.qualityVerifySource
    view.qualityVerifyStatus = qualityInfo.qualityVerifyStatus
    view.qualityVerifyDisplayLabel = qualityInfo.verifyDisplayLabel
    view.officialReasonText = qualityInfo.officialReasonText
    view.afterSaleReasonText = qualityInfo.afterSaleReasonText
    view.afterSaleSuccessTime = qualityInfo.afterSaleSuccessTime
    view.suspectedQualityRefund = qualityInfo.suspectedQualityRefund
    views.push(view)
  }

  return views
}

function computeGrossProfitForOverview(
  views: AnalyzedOrderView[],
  settlement: ReturnType<typeof preprocessSettlement> | undefined,
  hasPending: boolean,
  hasSettled: boolean,
): {
  cent: number
  note: string
  breakdown: ReturnType<typeof computeGrossProfitBreakdown> | null
} {
  const orderIds = new Set(views.map((v) => v.orderId).filter(Boolean))
  const gmvCent = sumEffectiveGmvCent(views)

  if (hasPending || hasSettled) {
    const breakdown = computeGrossProfitBreakdown(orderIds, gmvCent, settlement)
    const display = grossProfitToDisplay(breakdown)
    const note =
      breakdown.warnings.length > 0
        ? `${display.formula}；${breakdown.warnings.join('；')}`
        : breakdown.note
    return { cent: breakdown.grossProfitCent, note, breakdown }
  }

  const actualSigned = sumCent(
    views.filter((o) => o.isActualSigned).map((o) => o.actualSignedAmountCent),
  )
  return {
    cent: actualSigned,
    note: '未导入结算明细，当前毛利润为订单侧估算，未扣除平台费用',
    breakdown: null,
  }
}

function buildBuyerRankings(
  views: AnalyzedOrderView[],
  returnOrders: AnalyzedOrderView[],
  qualityOrders: AnalyzedOrderView[],
): {
  buyerReturnRanking: BuyerReturnRankItem[]
  buyerReturnCountRanking: BuyerReturnRankItem[]
  buyerPaymentRanking: BuyerPaymentRankItem[]
  buyerQualityReturnRanking: BuyerQualityReturnRankItem[]
} {
  const returnMap = new Map<
    string,
    { count: number; amount: number; latest: string; anchors: Set<string> }
  >()
  for (const o of returnOrders) {
    if (!o.buyerId) continue
    const cur = returnMap.get(o.buyerId) ?? {
      count: 0,
      amount: 0,
      latest: '',
      anchors: new Set<string>(),
    }
    cur.count += 1
    cur.amount += o.returnAmountCent
    if (o.anchorName) cur.anchors.add(o.anchorName)
    if (!cur.latest || o.orderTimeText > cur.latest) cur.latest = o.orderTimeText
    returnMap.set(o.buyerId, cur)
  }

  const buyerReturnRanking: BuyerReturnRankItem[] = [...returnMap.entries()]
    .map(([buyerId, v]) => ({
      buyerId,
      returnCount: v.count,
      returnAmountCent: v.amount,
      latestReturnTime: v.latest || '—',
      orderCount: v.count,
      anchors: [...v.anchors].join('、') || '—',
    }))
    .sort((a, b) => b.returnAmountCent - a.returnAmountCent)
    .slice(0, 10)

  const buyerReturnCountRanking = [...buyerReturnRanking].sort(
    (a, b) => b.returnCount - a.returnCount,
  )

  const payMap = new Map<
    string,
    { amount: number; count: number; latest: string; anchors: Set<string> }
  >()
  for (const o of views) {
    if (!o.buyerId) continue
    const cur = payMap.get(o.buyerId) ?? {
      amount: 0,
      count: 0,
      latest: '',
      anchors: new Set<string>(),
    }
    cur.amount += o.effectiveGmvCent
    cur.count += 1
    if (o.anchorName) cur.anchors.add(o.anchorName)
    if (!cur.latest || o.orderTimeText > cur.latest) cur.latest = o.orderTimeText
    payMap.set(o.buyerId, cur)
  }

  const buyerPaymentRanking: BuyerPaymentRankItem[] = [...payMap.entries()]
    .map(([buyerId, v]) => ({
      buyerId,
      paymentAmountCent: v.amount,
      orderCount: v.count,
      latestOrderTime: v.latest || '—',
      anchors: [...v.anchors].join('、') || '—',
    }))
    .sort((a, b) => b.paymentAmountCent - a.paymentAmountCent)
    .slice(0, 10)

  const buyerQualityReturnRanking: BuyerQualityReturnRankItem[] = [
    ...qualityOrders.reduce((map, o) => {
      const cur = map.get(o.buyerId) ?? { count: 0, amount: 0, reasons: [] as string[] }
      cur.count += 1
      cur.amount += o.returnAmountCent
      if (o.reasonText) cur.reasons.push(o.reasonText)
      map.set(o.buyerId, cur)
      return map
    }, new Map<string, { count: number; amount: number; reasons: string[] }>()),
  ]
    .map(([buyerId, v]) => ({
      buyerId,
      qualityReturnCount: v.count,
      qualityReturnAmountCent: v.amount,
      reasonSummary: v.reasons[0]?.slice(0, 30) || '—',
    }))
    .sort((a, b) => b.qualityReturnAmountCent - a.qualityReturnAmountCent)
    .slice(0, 10)

  return {
    buyerReturnRanking,
    buyerReturnCountRanking,
    buyerPaymentRanking,
    buyerQualityReturnRanking,
  }
}

function buildAnchorSummaryForAnchor(
  anchorId: string,
  anchorName: string,
  color: string,
  views: AnalyzedOrderView[],
  totalGmv: number,
  totalActualSigned: number,
  settlementByAnchor: ReturnType<typeof buildSettlementMaps>['byAnchor'],
  hasSettlement: boolean,
): AnchorSummary {
  const list = views.filter(
    (o) => o.anchorId === anchorId || o.anchorName === anchorName,
  )
    const gmvCent = sumEffectiveGmvCent(list)
    const orderCount = list.length
    const actualSigned = list.filter((o) => o.isActualSigned)
    const returns = list.filter((o) => o.isReturned)
    const qr = list.filter((o) => o.isQualityReturn)
    const settlement = settlementByAnchor.get(anchorId)

    let grossProfitCent = sumCent(actualSigned.map((o) => o.actualSignedAmountCent))
    if (hasSettlement && settlement) {
      const income = settlement.settledIncomeCent + settlement.pendingIncomeCent
      grossProfitCent = income - settlement.refundCent - settlement.feeCent
    }

    const actualSignedAmountCent = sumCent(
      actualSigned.map((o) => o.actualSignedAmountCent || 0),
    )

  return {
    anchorName,
    color,
    gmvCent,
    gmvShare: totalGmv > 0 ? gmvCent / totalGmv : 0,
    orderCount,
    actualSignedCount: actualSigned.length,
    actualSignedAmountCent,
    actualSignedShare: totalActualSigned > 0 ? actualSignedAmountCent / totalActualSigned : 0,
    returnCount: returns.length,
    returnRate: orderCount > 0 ? returns.length / orderCount : 0,
    qualityReturnCount: qr.length,
    qualityReturnAmountCent: sumCent(qr.map((o) => o.returnAmountCent)),
    settledAmountCent: settlement?.settledIncomeCent ?? 0,
    pendingAmountCent: settlement?.pendingIncomeCent ?? 0,
    grossProfitCent,
  }
}

function buildAnchorSummaries(
  views: AnalyzedOrderView[],
  totalGmv: number,
  config: AnchorConfig,
  settlementByAnchor: ReturnType<typeof buildSettlementMaps>['byAnchor'],
  hasSettlement: boolean,
): AnchorSummary[] {
  const totalActualSigned = sumCent(
    views.filter((o) => o.isActualSigned).map((o) => o.actualSignedAmountCent),
  )

  const summaries: AnchorSummary[] = config.anchors
    .filter((a) => a.enabled)
    .map((a) =>
      buildAnchorSummaryForAnchor(
        a.id,
        a.name,
        a.color,
        views,
        totalGmv,
        totalActualSigned,
        settlementByAnchor,
        hasSettlement,
      ),
    )

  const knownNames = new Set(config.anchors.map((a) => a.name))
  const extraNames = new Set<string>()
  for (const v of views) {
    if (!v.anchorName || knownNames.has(v.anchorName)) continue
    if (isShopOrInvalidAnchorLabel(v.anchorName)) continue
    extraNames.add(v.anchorName)
  }

  for (const name of extraNames) {
    const list = views.filter((o) => o.anchorName === name)
    const anchorId = list[0]?.anchorId ?? `extra-${name}`
    summaries.push(
      buildAnchorSummaryForAnchor(
        anchorId,
        name,
        '#94a3b8',
        views,
        totalGmv,
        totalActualSigned,
        settlementByAnchor,
        hasSettlement,
      ),
    )
  }

  return summaries
}

export function prepareAnalysisArtifacts(input: AnalyzeInput): AnalysisArtifacts {
  const warnings = [...input.warnings]

  const normalized = normalizeOrders(input.order.parsed, input.order.mapping)
  const dedupe = dedupeOrders(normalized)
  const range = computeAnalysisRange(dedupe.uniqueOrders)

  if (!range) {
    throw new Error('订单表没有有效下单时间，无法确定分析范围')
  }

  warnings.push(...range.warnings)

  const anchorConfig = getAnchorConfigSync()
  const liveNorm = input.live
    ? normalizeLiveSessions(input.live.parsed, input.live.mapping, anchorConfig)
    : { sessions: [], warnings: [] }
  warnings.push(...liveNorm.warnings)

  const attributions = attributeOrders(dedupe.uniqueOrders, liveNorm.sessions, anchorConfig)

  const orderAnchorByOrderId = new Map<string, string>()
  for (const o of dedupe.uniqueOrders) {
    const a = attributions.get(o.sourceRowIndex)
    if (a?.anchorId && o.matchOrderId) orderAnchorByOrderId.set(o.matchOrderId, a.anchorId)
  }

  const orderIds = new Set(dedupe.uniqueOrders.map((o) => o.matchOrderId))
  const settlement = preprocessSettlement(input.pending, input.settled)
  const { refundByOrder } = buildSettlementMaps(settlement, orderAnchorByOrderId, orderIds)

  const hasReasonField = Boolean(
    input.order.mapping.mappings.find((m) => m.key === 'refundReason' && m.header),
  )
  if (!hasReasonField) {
    warnings.push('订单表未识别到售后/退款原因字段，品退按原因缺失处理')
  }

  const orderQueries = buildLiveAccountOrderQueries(dedupe.uniqueOrders)
  const workbenchByOrderNo = getWorkbenchRefundMapForOrders(orderQueries)
  const views = buildViews(
    dedupe.uniqueOrders,
    attributions,
    refundByOrder,
    hasReasonField,
    workbenchByOrderNo,
  )

  return {
    dedupe,
    views,
    settlement,
    liveSessions: liveNorm.sessions,
    warnings,
  }
}

export function runBusinessAnalysis(input: AnalyzeInput): BusinessAnalysisResult {
  const errors: string[] = []
  const artifacts = prepareAnalysisArtifacts(input)
  const { dedupe, views, settlement } = artifacts
  const warnings = [...artifacts.warnings]
  const range = computeAnalysisRange(dedupe.uniqueOrders)!

  const anchorConfig = getAnchorConfigSync()
  const orderAnchorByOrderId = new Map<string, string>()
  for (const v of views) {
    if (v.anchorId && v.matchOrderId) orderAnchorByOrderId.set(v.matchOrderId, v.anchorId)
  }
  const orderIds = new Set(dedupe.uniqueOrders.map((o) => o.matchOrderId))
  const { billUnmatchedCount, byAnchor } = buildSettlementMaps(
    settlement,
    orderAnchorByOrderId,
    orderIds,
  )

  const orderCount = views.length
  const gmvCent = sumEffectiveGmvCent(views)
  const actualSignedOrders = views.filter((o) => o.isActualSigned)
  const returnOrders = views.filter((o) => o.isReturned)
  const qualityOrders = views.filter((o) => o.isQualityReturn)

  const hasSettlement = input.hasPendingFile || input.hasSettledFile
  const gross = computeGrossProfitForOverview(
    views,
    settlement,
    input.hasPendingFile,
    input.hasSettledFile,
  )

  if (!input.hasPendingFile) {
    warnings.push('未导入待结算明细，待结算金额显示为 0')
  }
  if (!input.hasSettledFile) {
    warnings.push('未导入已结算明细，已结算金额显示为 0')
  }

  const overview: BusinessOverview = {
    analysisRangeText: range.displayText,
    gmvCent,
    orderCount,
    actualSignedCount: actualSignedOrders.length,
    actualSignedAmountCent: sumCent(
      actualSignedOrders.map((o) => o.actualSignedAmountCent || 0),
    ),
    returnCount: returnOrders.length,
    returnAmountCent: sumCent(returnOrders.map((o) => o.returnAmountCent)),
    returnRate: orderCount > 0 ? returnOrders.length / orderCount : 0,
    qualityReturnCount: qualityOrders.length,
    qualityReturnAmountCent: sumCent(qualityOrders.map((o) => o.returnAmountCent)),
    qualityReturnRate: orderCount > 0 ? qualityOrders.length / orderCount : 0,
    settledAmountCent: sumSettlementDirection(settlement, 'settled', 'income'),
    pendingAmountCent: sumSettlementDirection(settlement, 'pending', 'income'),
    grossProfitCent: gross.cent,
    grossProfitNote: gross.note,
    grossProfitBreakdown: gross.breakdown
      ? (grossProfitToDisplay(gross.breakdown) as unknown as Record<string, unknown>)
      : null,
    abnormalOrderCount: dedupe.abnormalOrders.length,
    unassignedOrderCount: views.filter((o) => o.attributionType === 'unassigned').length,
    billUnmatchedCount,
    warnings,
  }

  const anchorSummaries = buildAnchorSummaries(
    views,
    gmvCent,
    anchorConfig,
    byAnchor,
    hasSettlement,
  )

  const {
    buyerReturnRanking,
    buyerReturnCountRanking,
    buyerPaymentRanking,
    buyerQualityReturnRanking,
  } = buildBuyerRankings(views, returnOrders, qualityOrders)

  const returnDetails: ReturnDetailItem[] = returnOrders.slice(0, 50).map((o) => ({
    orderId: o.orderId,
    buyerId: o.buyerId,
    anchorName: o.anchorName,
    gmvCent: o.gmvCent,
    reasonText: o.reasonText || '—',
    isQualityReturn: o.isQualityReturn,
  }))

  if (dedupe.abnormalOrders.length > 0) {
    warnings.push(`存在 ${dedupe.abnormalOrders.length} 条异常订单，未计入正常统计`)
  }

  const unassignedOrders: UnassignedOrderItem[] = views
    .filter((o) => o.attributionType === 'unassigned')
    .slice(0, 100)
    .map((o) => ({
      orderId: o.orderId,
      orderTimeText: o.orderTimeText,
      gmvCent: o.gmvCent,
      reason: '未匹配直播场次或时间规则',
    }))

  const abnormalOrders: AbnormalOrderItem[] = dedupe.abnormalOrders
    .slice(0, 100)
    .map((o) => ({
      sourceRowIndex: o.sourceRowIndex,
      orderId: o.orderId || '—',
      errors: o.errors,
    }))

  return {
    overview,
    anchorSummaries,
    buyerReturnRanking,
    buyerReturnCountRanking,
    buyerPaymentRanking,
    buyerQualityReturnRanking,
    returnDetails,
    unassignedOrders,
    abnormalOrders,
    errors,
  }
}

export interface RawAnalyzeBundle {
  orders: NormalizedOrder[]
  liveSessions: LiveSession[]
  pendingRecords: SettlementRecord[]
  settledRecords: SettlementRecord[]
  hasPending: boolean
  hasSettled: boolean
  warnings: string[]
  afterSaleByOrderNo?: Map<string, import('./xhs-after-sales-range.service').AfterSaleOrderAggregate>
  rawAfterSalesByOrderNo?: Map<string, Record<string, unknown>[]>
  unmatchedAfterSaleRecords?: import('./order-master-match.service').UnmatchedAfterSaleRecord[]
  fetchMeta?: {
    orderPagesRead?: number
    orderRowsRead?: number
    afterSalePagesRead?: number
    afterSaleRowsRead?: number
  }
}

export function prepareAnalysisArtifactsFromRaw(
  bundle: RawAnalyzeBundle,
  options?: {
    statRange?: DateRangeResolved
    workbenchByOrderNo?: Map<string, import('./xhs-after-sales-workbench.service').AfterSalesWorkbenchRefund>
  },
): AnalysisArtifacts {
  const warnings = [...bundle.warnings]
  const primaryOrders = filterPrimaryOrdersForMetrics(bundle.orders)
  warnings.push(...warnPrimaryOrderIntegrity(bundle.orders))
  const { validOrders, abnormalOrders } = partitionOrdersByResolvableTime(primaryOrders)
  if (abnormalOrders.length > 0) {
    warnings.push(`有 ${abnormalOrders.length} 笔订单时间异常，未计入本期统计`)
  }
  const dedupe = dedupeOrders(validOrders)
  const range = computeAnalysisRange(dedupe.uniqueOrders)
  const settlement = preprocessSettlementFromRecords(
    bundle.pendingRecords,
    bundle.settledRecords,
  )
  if (!range) {
    return {
      dedupe: {
        uniqueOrders: [],
        duplicateOrders: [],
        abnormalOrders,
        summary: {
          rawRowCount: primaryOrders.length,
          uniqueOrderCount: 0,
          abnormalCount: abnormalOrders.length,
          totalGmvCent: 0,
        },
      },
      views: [],
      settlement,
      liveSessions: bundle.liveSessions,
      warnings,
      abnormalOrderCount: abnormalOrders.length,
      abnormalOrderNos: abnormalOrders.map(abnormalOrderDisplayNo).filter(Boolean),
    }
  }
  warnings.push(...range.warnings)

  const anchorConfig = getAnchorConfigSync()
  const attributions = attributeOrders(
    dedupe.uniqueOrders,
    bundle.liveSessions,
    anchorConfig,
  )

  const orderAnchorByOrderId = new Map<string, string>()
  for (const o of dedupe.uniqueOrders) {
    const a = attributions.get(o.sourceRowIndex)
    if (a?.anchorId && o.matchOrderId) orderAnchorByOrderId.set(o.matchOrderId, a.anchorId)
  }
  const orderIds = new Set(dedupe.uniqueOrders.map((o) => o.matchOrderId))
  const { refundByOrder } = buildSettlementMaps(
    settlement,
    orderAnchorByOrderId,
    orderIds,
  )

  const orderQueries = buildLiveAccountOrderQueries(dedupe.uniqueOrders)
  void bootstrapWorkbenchCache()
  const workbenchByOrderNo =
    options?.workbenchByOrderNo ?? getWorkbenchRefundMapForOrders(orderQueries)
  const views = buildViews(
    dedupe.uniqueOrders,
    attributions,
    refundByOrder,
    false,
    workbenchByOrderNo,
    bundle.afterSaleByOrderNo,
    bundle.rawAfterSalesByOrderNo,
    options?.statRange,
  )

  return {
    dedupe,
    views,
    settlement,
    liveSessions: bundle.liveSessions,
    warnings,
    abnormalOrderCount: abnormalOrders.length,
    abnormalOrderNos: abnormalOrders.map(abnormalOrderDisplayNo).filter(Boolean),
  }
}

export {
  warmWorkbenchCacheForOrders,
  type WarmWorkbenchResult,
} from './workbench-cache-warm.service'

export function runBusinessAnalysisFromRaw(bundle: RawAnalyzeBundle): BusinessAnalysisResult {
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const { dedupe, views, settlement } = artifacts
  const warnings = [...artifacts.warnings]
  const range = computeAnalysisRange(dedupe.uniqueOrders)
  if (!range) {
    warnings.push('订单没有有效下单时间，分析范围为空')
  }

  const anchorConfig = getAnchorConfigSync()
  const orderAnchorByOrderId = new Map<string, string>()
  for (const v of views) {
    if (v.anchorId && v.matchOrderId) orderAnchorByOrderId.set(v.matchOrderId, v.anchorId)
  }
  const orderIds = new Set(dedupe.uniqueOrders.map((o) => o.matchOrderId))
  const { billUnmatchedCount, byAnchor } = buildSettlementMaps(
    settlement,
    orderAnchorByOrderId,
    orderIds,
  )

  const orderCount = views.length
  const gmvCent = sumEffectiveGmvCent(views)
  const actualSignedOrders = views.filter((o) => o.isActualSigned)
  const returnOrders = views.filter((o) => o.isReturned)
  const qualityOrders = views.filter((o) => o.isQualityReturn)

  const hasSettlement = bundle.hasPending || bundle.hasSettled
  const gross = computeGrossProfitForOverview(
    views,
    settlement,
    bundle.hasPending,
    bundle.hasSettled,
  )

  if (!bundle.hasPending) {
    warnings.push('未导入待结算明细，待结算金额显示为 0')
  }
  if (!bundle.hasSettled) {
    warnings.push('未导入已结算明细，已结算金额显示为 0')
  }

  const returnAmountCent = sumCent(returnOrders.map((o) => o.returnAmountCent))

  const overview: BusinessOverview = {
    analysisRangeText: range?.displayText ?? '',
    gmvCent,
    orderCount,
    actualSignedCount: actualSignedOrders.length,
    actualSignedAmountCent: sumCent(
      actualSignedOrders.map((o) => o.actualSignedAmountCent || 0),
    ),
    returnCount: returnOrders.length,
    returnAmountCent,
    returnByOrderMonthCent: returnAmountCent,
    returnByRefundMonthCent: returnAmountCent,
    returnRate: orderCount > 0 ? returnOrders.length / orderCount : 0,
    qualityReturnCount: qualityOrders.length,
    qualityReturnAmountCent: sumCent(qualityOrders.map((o) => o.returnAmountCent)),
    qualityReturnRate: orderCount > 0 ? qualityOrders.length / orderCount : 0,
    settledAmountCent: sumSettlementDirection(settlement, 'settled', 'income'),
    pendingAmountCent: sumSettlementDirection(settlement, 'pending', 'income'),
    grossProfitCent: gross.cent,
    grossProfitNote: gross.note,
    grossProfitBreakdown: gross.breakdown
      ? (grossProfitToDisplay(gross.breakdown) as unknown as Record<string, unknown>)
      : null,
    abnormalOrderCount: dedupe.abnormalOrders.length,
    unassignedOrderCount: views.filter((o) => o.attributionType === 'unassigned').length,
    billUnmatchedCount,
    warnings,
  }

  const anchorSummaries = buildAnchorSummaries(
    views,
    gmvCent,
    anchorConfig,
    byAnchor,
    hasSettlement,
  )

  const {
    buyerReturnRanking,
    buyerReturnCountRanking,
    buyerPaymentRanking,
    buyerQualityReturnRanking,
  } = buildBuyerRankings(views, returnOrders, qualityOrders)

  const returnDetails: ReturnDetailItem[] = returnOrders.slice(0, 50).map((o) => ({
    orderId: o.orderId,
    buyerId: o.buyerId,
    anchorName: o.anchorName,
    gmvCent: o.gmvCent,
    reasonText: o.reasonText || '—',
    isQualityReturn: o.isQualityReturn,
  }))

  if (dedupe.abnormalOrders.length > 0) {
    warnings.push(`存在 ${dedupe.abnormalOrders.length} 条异常订单，未计入正常统计`)
  }

  const unassignedOrders: UnassignedOrderItem[] = views
    .filter((o) => o.attributionType === 'unassigned')
    .slice(0, 100)
    .map((o) => ({
      orderId: o.orderId,
      orderTimeText: o.orderTimeText,
      gmvCent: o.gmvCent,
      reason: '未匹配直播场次或时间规则',
    }))

  const abnormalOrders: AbnormalOrderItem[] = dedupe.abnormalOrders
    .slice(0, 100)
    .map((o) => ({
      sourceRowIndex: o.sourceRowIndex,
      orderId: o.orderId || '—',
      errors: o.errors,
    }))

  return {
    overview,
    anchorSummaries,
    buyerReturnRanking,
    buyerReturnCountRanking,
    buyerPaymentRanking,
    buyerQualityReturnRanking,
    returnDetails,
    unassignedOrders,
    abnormalOrders,
    errors: [],
  }
}
