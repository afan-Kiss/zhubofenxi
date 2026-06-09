import type { AnchorConfig } from '../types/anchor'
import type { FieldMappingResult } from '../types/fieldMapping'
import type {
  AnalyzedOrderView,
  AnchorSummary,
  AttributionValidation,
  BusinessAnalysisResult,
  BusinessOverview,
  BuyerQualityReturnRankItem,
  BuyerReturnRankItem,
  QualityReturnInsight,
  UnmatchedBillSummary,
} from '../types/business'
import type { ImportedExcelFile } from '../types/import'
import type { StandardOrder } from '../types/order'
import type { SettlementPreprocessResult, SettlementRecord } from '../types/settlement'
import { getEnabledAnchors } from './anchorRules'
import { normalizeLiveSessions } from './liveSessionNormalizer'
import { attributeOrder, attributeOrders } from './orderAttribution'
import { preprocessOrders } from './orderPreprocessor'
import { preprocessSettlement } from './settlementPreprocessor'
import { isQualityReturnReason } from './qualityReturn'
import { addCent, formatCentToMoney, sumCent } from './money'

export interface AnalyzeBusinessInput {
  orderFile?: ImportedExcelFile
  orderMapping: FieldMappingResult | null
  liveFile?: ImportedExcelFile
  liveMapping: FieldMappingResult | null
  pendingFile?: ImportedExcelFile
  pendingMapping: FieldMappingResult | null
  settledFile?: ImportedExcelFile
  settledMapping: FieldMappingResult | null
  anchorConfig: AnchorConfig
  analysisMonth?: string
}

function pickDominantMonth(orders: StandardOrder[]): string {
  const counts = new Map<string, number>()
  for (const o of orders) {
    if (!o.monthKey) continue
    counts.set(o.monthKey, (counts.get(o.monthKey) ?? 0) + 1)
  }
  let best = ''
  let max = 0
  for (const [m, c] of counts) {
    if (c > max) {
      max = c
      best = m
    }
  }
  return best
}

interface AnchorSettlementBucket {
  settledIncomeCent: number
  pendingIncomeCent: number
  refundCent: number
  feeCent: number
}

interface SettlementMaps {
  refundByOrder: Map<string, number>
  allBillOrderIds: Set<string>
  byAnchor: Map<string, AnchorSettlementBucket>
  unmatchedBill: UnmatchedBillSummary
}

function buildSettlementMaps(
  result: SettlementPreprocessResult | undefined,
  orderAnchorByOrderId: Map<string, string>,
): SettlementMaps {
  const refundByOrder = new Map<string, number>()
  const allBillOrderIds = new Set<string>()
  const byAnchor = new Map<string, AnchorSettlementBucket>()
  let unmatchedCount = 0
  let unmatchedAmountCent = 0

  const touchAnchor = (anchorId: string): AnchorSettlementBucket => {
    if (!byAnchor.has(anchorId)) {
      byAnchor.set(anchorId, {
        settledIncomeCent: 0,
        pendingIncomeCent: 0,
        refundCent: 0,
        feeCent: 0,
      })
    }
    return byAnchor.get(anchorId)!
  }

  const ingest = (records: SettlementRecord[], billType: 'pending' | 'settled') => {
    for (const r of records) {
      if (!r.orderId) continue
      allBillOrderIds.add(r.orderId)

      const anchorId = orderAnchorByOrderId.get(r.orderId)
      if (!anchorId) {
        unmatchedCount += 1
        if (r.direction === 'income' || r.direction === 'refund') {
          unmatchedAmountCent = addCent(unmatchedAmountCent, Math.abs(r.amountCent))
        }
        if (r.direction === 'refund') {
          refundByOrder.set(r.orderId, addCent(refundByOrder.get(r.orderId) ?? 0, Math.abs(r.amountCent)))
        }
        continue
      }

      const bucket = touchAnchor(anchorId)
      if (r.direction === 'income') {
        if (billType === 'pending') {
          bucket.pendingIncomeCent = addCent(bucket.pendingIncomeCent, r.amountCent)
        } else {
          bucket.settledIncomeCent = addCent(bucket.settledIncomeCent, r.amountCent)
        }
      }
      if (r.direction === 'refund') {
        const abs = Math.abs(r.amountCent)
        bucket.refundCent = addCent(bucket.refundCent, abs)
        refundByOrder.set(r.orderId, addCent(refundByOrder.get(r.orderId) ?? 0, abs))
      }
      if (r.direction === 'fee') {
        bucket.feeCent = addCent(bucket.feeCent, Math.abs(r.amountCent))
      }
    }
  }

  if (result) {
    ingest(result.pendingRecords, 'pending')
    ingest(result.abnormalPendingRecords, 'pending')
    ingest(result.settledRecords, 'settled')
    ingest(result.abnormalSettledRecords, 'settled')
  }

  return {
    refundByOrder,
    allBillOrderIds,
    byAnchor,
    unmatchedBill: { count: unmatchedCount, amountCent: unmatchedAmountCent },
  }
}

function sumSettlementDirection(
  result: SettlementPreprocessResult | undefined,
  type: 'pending' | 'settled',
  direction: SettlementRecord['direction'],
): number {
  if (!result) return 0
  const list =
    type === 'pending'
      ? [...result.pendingRecords, ...result.abnormalPendingRecords]
      : [...result.settledRecords, ...result.abnormalSettledRecords]
  return sumCent(list.filter((r) => r.direction === direction).map((r) => r.amountCent))
}

function enrichAndAttributeOrders(
  uniqueOrders: StandardOrder[],
  refundByOrder: Map<string, number>,
  month: string,
  hasReasonField: boolean,
  sessions: ReturnType<typeof normalizeLiveSessions>['sessions'],
  anchorConfig: AnchorConfig,
  attributions: Map<number, import('../types/anchor').OrderAttribution>,
  attrWarnings: string[],
): { views: AnalyzedOrderView[]; warnings: string[] } {
  const warnings = [...attrWarnings]
  const views: AnalyzedOrderView[] = []

  for (const o of uniqueOrders) {
    const inMonth = !month || !o.monthKey || o.monthKey === month
    if (!inMonth) continue

    const attr = attributions.get(o.sourceRowIndex) ?? {
      anchorId: '',
      anchorName: '未归属',
      attributionType: 'unassigned' as const,
    }

    const isActualSigned = o.isSigned && !o.isRefunded
    let returnAmountCent = 0
    let returnAmountSource: AnalyzedOrderView['returnAmountSource'] = 'none'

    if (o.isRefunded) {
      const billRefund = refundByOrder.get(o.orderId)
      if (billRefund && billRefund > 0) {
        returnAmountCent = billRefund
        returnAmountSource = 'bill'
      } else {
        returnAmountCent = o.gmvCent
        returnAmountSource = 'order_estimate'
      }
    }

    const isQualityReturn =
      o.isRefunded && hasReasonField && isQualityReturnReason(o.reasonText)

    views.push({
      sourceRowIndex: o.sourceRowIndex,
      orderId: o.orderId,
      orderTimeText: o.orderTimeText,
      buyerId: o.buyerId || '未知买家',
      anchorId: attr.anchorId,
      anchorName: attr.anchorName,
      attributionType: attr.attributionType,
      matchedRuleId: attr.matchedRuleId,
      matchedRuleName: attr.matchedRuleName,
      matchedLiveSessionId: attr.matchedLiveSessionId,
      matchedLiveStartTime: attr.matchedLiveStartTime,
      matchedLiveEndTime: attr.matchedLiveEndTime,
      attributionWarning: attr.attributionWarning,
      gmvCent: o.gmvCent,
      isSigned: o.isSigned,
      isRefunded: o.isRefunded,
      isActualSigned,
      isQualityReturn,
      returnAmountCent,
      returnAmountSource,
      reasonText: o.reasonText,
      errors: o.errors,
      raw: o.raw,
    })
  }

  if (!hasReasonField) {
    warnings.push('订单表未识别到售后/退款原因字段，品退按原因缺失处理')
  }

  return { views, warnings: [...new Set(warnings)] }
}

function buildBuyerReturnRanking(orders: AnalyzedOrderView[]): BuyerReturnRankItem[] {
  const map = new Map<string, { count: number; amount: number; latest: string }>()
  for (const o of orders) {
    if (!o.isRefunded) continue
    const id = o.buyerId || '未知买家'
    const cur = map.get(id) ?? { count: 0, amount: 0, latest: '' }
    cur.count += 1
    cur.amount = addCent(cur.amount, o.returnAmountCent)
    if (!cur.latest || o.orderTimeText > cur.latest) cur.latest = o.orderTimeText
    map.set(id, cur)
  }
  return [...map.entries()]
    .map(([buyerId, v]) => ({
      buyerId,
      returnCount: v.count,
      returnAmountCent: v.amount,
      latestReturnTime: v.latest || '—',
    }))
    .sort((a, b) => b.returnAmountCent - a.returnAmountCent)
    .slice(0, 10)
}

function buildBuyerQualityRanking(orders: AnalyzedOrderView[]): BuyerQualityReturnRankItem[] {
  const map = new Map<string, { count: number; amount: number; reasons: string[] }>()
  for (const o of orders) {
    if (!o.isQualityReturn) continue
    const id = o.buyerId || '未知买家'
    const cur = map.get(id) ?? { count: 0, amount: 0, reasons: [] }
    cur.count += 1
    cur.amount = addCent(cur.amount, o.returnAmountCent)
    if (o.reasonText) cur.reasons.push(o.reasonText)
    map.set(id, cur)
  }
  return [...map.entries()]
    .map(([buyerId, v]) => ({
      buyerId,
      qualityReturnCount: v.count,
      qualityReturnAmountCent: v.amount,
      reasonSummary: v.reasons[0]?.slice(0, 30) || '—',
    }))
    .sort((a, b) => b.qualityReturnAmountCent - a.qualityReturnAmountCent)
    .slice(0, 10)
}

function buildAnchorSummaries(
  orders: AnalyzedOrderView[],
  totalGmv: number,
  anchorConfig: AnchorConfig,
  settlementByAnchor: Map<string, AnchorSettlementBucket>,
  hasSettlement: boolean,
  grossProfitNoteBase: string,
): AnchorSummary[] {
  const enabled = getEnabledAnchors(anchorConfig)
  const anchorIdsInOrders = new Set(
    orders.filter((o) => o.anchorId && o.attributionType !== 'unassigned').map((o) => o.anchorId),
  )

  const anchorList = [...enabled]
  for (const id of anchorIdsInOrders) {
    if (!anchorList.some((a) => a.id === id)) {
      const name = orders.find((o) => o.anchorId === id)?.anchorName ?? id
      anchorList.push({
        id,
        name,
        color: '#94a3b8',
        enabled: true,
        createdAt: new Date().toISOString(),
      })
    }
  }

  return anchorList.map((anchor) => {
    const list = orders.filter((o) => o.anchorId === anchor.id)
    const gmvCent = sumCent(list.map((o) => o.gmvCent))
    const orderCount = list.length
    const actualSigned = list.filter((o) => o.isActualSigned)
    const returns = list.filter((o) => o.isRefunded)
    const qr = list.filter((o) => o.isQualityReturn)

    const settlement = settlementByAnchor.get(anchor.id)
    let settledAmountCent = settlement?.settledIncomeCent ?? 0
    let pendingAmountCent = settlement?.pendingIncomeCent ?? 0
    let grossProfitCent = sumCent(actualSigned.map((o) => o.gmvCent))
    let grossProfitNote: string | undefined

    if (hasSettlement && settlement) {
      const income = addCent(settlement.settledIncomeCent, settlement.pendingIncomeCent)
      grossProfitCent = income - settlement.refundCent - settlement.feeCent
      grossProfitNote = grossProfitNoteBase
    } else if (!hasSettlement) {
      grossProfitNote = '未导入结算明细，毛利润为订单侧估算'
    }

    return {
      anchorId: anchor.id,
      anchorName: anchor.name,
      color: anchor.color,
      gmvCent,
      gmvShare: totalGmv > 0 ? gmvCent / totalGmv : 0,
      orderCount,
      actualSignedCount: actualSigned.length,
      actualSignedAmountCent: sumCent(actualSigned.map((o) => o.gmvCent)),
      returnCount: returns.length,
      returnRate: orderCount > 0 ? returns.length / orderCount : 0,
      qualityReturnCount: qr.length,
      qualityReturnAmountCent: sumCent(qr.map((o) => o.returnAmountCent)),
      settledAmountCent,
      pendingAmountCent,
      grossProfitCent,
      grossProfitNote,
    }
  })
}

function computeGrossProfit(
  orders: AnalyzedOrderView[],
  settlement: SettlementPreprocessResult | undefined,
  hasPending: boolean,
  hasSettled: boolean,
): { cent: number; note: string } {
  if (hasPending || hasSettled) {
    const income = addCent(
      sumSettlementDirection(settlement, 'settled', 'income'),
      sumSettlementDirection(settlement, 'pending', 'income'),
    )
    const refund = addCent(
      sumSettlementDirection(settlement, 'settled', 'refund'),
      sumSettlementDirection(settlement, 'pending', 'refund'),
    )
    const fee = addCent(
      sumSettlementDirection(settlement, 'settled', 'fee'),
      sumSettlementDirection(settlement, 'pending', 'fee'),
    )
    const hasFee = fee > 0
    const cent = income - refund - fee
    if (!hasFee) {
      return {
        cent,
        note: '经营毛利（未扣商品成本）；平台扣费字段未识别，当前未扣除平台费用',
      }
    }
    return {
      cent,
      note: '经营毛利（未扣商品采购成本，非净利润）= 正向货款 - 退款扣回 - 平台扣费',
    }
  }

  const actualSigned = sumCent(orders.filter((o) => o.isActualSigned).map((o) => o.gmvCent))
  return {
    cent: actualSigned,
    note: '未导入结算明细，当前毛利按实际签收金额估算，未扣除平台费用',
  }
}

function validateAttribution(
  views: AnalyzedOrderView[],
  abnormalCount: number,
): AttributionValidation {
  const anchorOrderSum = views.filter(
    (o) => o.anchorId && o.attributionType !== 'unassigned' && o.attributionType !== 'abnormal',
  ).length
  const unassignedCount = views.filter((o) => o.attributionType === 'unassigned').length
  const totalInViews = views.length

  const orderCountOk = anchorOrderSum + unassignedCount === totalInViews

  const anchorGmv = sumCent(
    views
      .filter((o) => o.anchorId && o.attributionType !== 'unassigned')
      .map((o) => o.gmvCent),
  )
  const unassignedGmv = sumCent(
    views.filter((o) => o.attributionType === 'unassigned').map((o) => o.gmvCent),
  )
  const totalGmv = sumCent(views.map((o) => o.gmvCent))
  const gmvOk = anchorGmv + unassignedGmv === totalGmv

  return {
    orderCountOk,
    gmvOk,
    orderCountMessage: orderCountOk
      ? undefined
      : `订单归属校验失败，存在漏单风险（主播${anchorOrderSum}+未归属${unassignedCount}≠${totalInViews}，另含异常${abnormalCount}单）`,
    gmvMessage: gmvOk
      ? undefined
      : 'GMV 归属校验失败，存在金额遗漏风险',
  }
}

export function analyzeBusiness(input: AnalyzeBusinessInput): {
  ok: boolean
  message?: string
  result?: BusinessAnalysisResult
} {
  const {
    orderFile,
    orderMapping,
    liveFile,
    liveMapping,
    pendingFile,
    pendingMapping,
    settledFile,
    settledMapping,
    anchorConfig,
  } = input

  if (!orderFile || !orderMapping) {
    return { ok: false, message: '请先上传当月订单表' }
  }
  if (orderMapping.missingRequiredFields.length > 0) {
    return {
      ok: false,
      message: '订单表缺少关键字段，请到高级设置 / 字段诊断处理',
    }
  }

  try {
    const orderPrep = preprocessOrders(orderFile, orderMapping)
    if (!orderPrep.ok || !orderPrep.dedupeResult) {
      return { ok: false, message: orderPrep.message ?? '订单预处理失败' }
    }

    const settlementPrep = preprocessSettlement(
      pendingFile,
      pendingMapping,
      settledFile,
      settledMapping,
    )
    const settlement = settlementPrep.ok ? settlementPrep.result : undefined

    const liveNorm = normalizeLiveSessions(liveFile, liveMapping, anchorConfig)

    const month = input.analysisMonth || pickDominantMonth(orderPrep.dedupeResult.uniqueOrders) || ''

    const preAttr = attributeOrders(
      orderPrep.dedupeResult.uniqueOrders,
      liveNorm.sessions,
      anchorConfig,
    )

    const orderAnchorByOrderId = new Map<string, string>()
    for (const o of orderPrep.dedupeResult.uniqueOrders) {
      const a = preAttr.attributions.get(o.sourceRowIndex)
      if (a?.anchorId && o.orderId) orderAnchorByOrderId.set(o.orderId, a.anchorId)
    }

    const { refundByOrder, allBillOrderIds, byAnchor, unmatchedBill } = buildSettlementMaps(
      settlement,
      orderAnchorByOrderId,
    )

    const hasReasonField = Boolean(
      orderMapping.mappings.find((m) => m.key === 'refundReason' && m.header),
    )

    const { views, warnings: enrichWarnings } = enrichAndAttributeOrders(
      orderPrep.dedupeResult.uniqueOrders,
      refundByOrder,
      month,
      hasReasonField,
      liveNorm.sessions,
      anchorConfig,
      preAttr.attributions,
      preAttr.warnings,
    )

    const warnings = [...liveNorm.warnings, ...enrichWarnings]
    const errors: string[] = []

    const orderIds = new Set(views.map((o) => o.orderId))
    let unmatchedBillOrderCount = 0
    for (const id of allBillOrderIds) {
      if (!orderIds.has(id)) unmatchedBillOrderCount++
    }

    const orderCount = views.length
    const gmvCent = sumCent(views.map((o) => o.gmvCent))
    const actualSignedOrders = views.filter((o) => o.isActualSigned)
    const returnOrders = views.filter((o) => o.isRefunded)
    const qualityOrders = views.filter((o) => o.isQualityReturn)

    const settledAmountCent = sumSettlementDirection(settlement, 'settled', 'income')
    const pendingAmountCent = sumSettlementDirection(settlement, 'pending', 'income')

    const hasSettlement = Boolean(pendingFile || settledFile)
    const gross = computeGrossProfit(
      views,
      settlement,
      Boolean(pendingFile),
      Boolean(settledFile),
    )

    const unassignedOrderCount = views.filter((o) => o.attributionType === 'unassigned').length
    const abnormalOrderCount = orderPrep.dedupeResult.abnormalOrders.length

    const attributionValidation = validateAttribution(views, abnormalOrderCount)

    const overview: BusinessOverview = {
      gmvCent,
      orderCount,
      actualSignedCount: actualSignedOrders.length,
      actualSignedAmountCent: sumCent(actualSignedOrders.map((o) => o.gmvCent)),
      returnCount: returnOrders.length,
      returnAmountCent: sumCent(returnOrders.map((o) => o.returnAmountCent)),
      returnRate: orderCount > 0 ? returnOrders.length / orderCount : 0,
      qualityReturnCount: qualityOrders.length,
      qualityReturnAmountCent: sumCent(qualityOrders.map((o) => o.returnAmountCent)),
      qualityReturnRate: orderCount > 0 ? qualityOrders.length / orderCount : 0,
      settledAmountCent,
      pendingAmountCent,
      grossProfitCent: gross.cent,
      grossProfitNote: gross.note,
      abnormalOrderCount,
      unassignedOrderCount,
      unmatchedBillOrderCount: Math.max(unmatchedBillOrderCount, unmatchedBill.count),
      unmatchedBillAmountCent: unmatchedBill.amountCent,
      qualityReasonMissing: !hasReasonField,
    }

    const anchorSummaries = buildAnchorSummaries(
      views,
      gmvCent,
      anchorConfig,
      byAnchor,
      hasSettlement,
      gross.note,
    )

    const qrBuyers = new Set(qualityOrders.map((o) => o.buyerId))
    let topBuyerId = '—'
    let topBuyerAmountCent = 0
    for (const o of qualityOrders) {
      if (o.returnAmountCent > topBuyerAmountCent) {
        topBuyerAmountCent = o.returnAmountCent
        topBuyerId = o.buyerId
      }
    }

    const qualityReturn: QualityReturnInsight = {
      qualityReturnCount: overview.qualityReturnCount,
      qualityReturnAmountCent: overview.qualityReturnAmountCent,
      qualityReturnRate: overview.qualityReturnRate,
      buyerCount: qrBuyers.size,
      topBuyerId,
      topBuyerAmountCent,
      reasonMissing: overview.qualityReasonMissing,
    }

    if (abnormalOrderCount > 0) {
      warnings.push(`存在 ${abnormalOrderCount} 条异常订单，请查看异常提醒`)
    }
    if (unassignedOrderCount > 0) {
      warnings.push(`存在未归属订单 ${unassignedOrderCount} 单，建议检查主播时间规则`)
    }
    if (!attributionValidation.orderCountOk && attributionValidation.orderCountMessage) {
      errors.push(attributionValidation.orderCountMessage)
    }
    if (!attributionValidation.gmvOk && attributionValidation.gmvMessage) {
      errors.push(attributionValidation.gmvMessage)
    }
    if (overview.unmatchedBillOrderCount > 0) {
      warnings.push(
        `账单未匹配订单 ${overview.unmatchedBillOrderCount} 笔，金额约 ${formatCentToMoney(overview.unmatchedBillAmountCent)}`,
      )
    }

    const abnormalViews: AnalyzedOrderView[] = orderPrep.dedupeResult.abnormalOrders.map((o) => {
      const attr = attributeOrder(o, liveNorm.sessions, anchorConfig, new Map(), [])
      return {
        sourceRowIndex: o.sourceRowIndex,
        orderId: o.orderId || '—',
        orderTimeText: o.orderTimeText,
        buyerId: o.buyerId || '未知买家',
        anchorId: attr.anchorId,
        anchorName: attr.anchorName,
        attributionType: 'abnormal',
        attributionWarning: o.errors.join('；') || attr.attributionWarning,
        gmvCent: o.gmvCent,
        isSigned: o.isSigned,
        isRefunded: o.isRefunded,
        isActualSigned: false,
        isQualityReturn: false,
        returnAmountCent: 0,
        returnAmountSource: 'none',
        reasonText: o.reasonText,
        errors: o.errors,
        raw: o.raw,
      }
    })

    return {
      ok: true,
      result: {
        month,
        overview,
        anchorSummaries,
        qualityReturn,
        buyerReturnRanking: buildBuyerReturnRanking(views),
        buyerQualityReturnRanking: buildBuyerQualityRanking(views),
        analyzedOrders: views,
        abnormalOrders: abnormalViews,
        attributionValidation,
        unmatchedBills: unmatchedBill,
        warnings,
        errors,
      },
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : '分析失败，请检查表格数据',
    }
  }
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

export { formatCentToMoney }
