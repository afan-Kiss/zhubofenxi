import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { resolveDateRange } from '../utils/date-range'
import { centToYuan } from '../utils/money'
import {
  AMOUNT_FORMULA_VERSION,
  sumEffectiveGmvCent,
} from './order-amount-metrics.service'
import { aggregateViewsMetrics } from './board-metrics.service'
import { mapViewToBoardOrderRow } from './order-row-mapper.service'
import { computeGrossProfitBreakdown } from './gross-profit.service'
import { buildOrderSettlementKeyIndex } from './settlement-order-key-match.util'
import type { AnalyzedOrderView } from '../types/analysis'

export interface AmountCheckRow {
  orderNo: string
  buyerNickname: string
  buyerId: string
  anchorName: string
  productName: string
  orderTime: string
  payAmount: number
  refundAmount: number
  actualAmount: number
  signedAmount: number
  orderStatus: string
  afterSaleStatus: string
  afterSaleReason: string
  amountNote: string
  statusText: string
  inProductGmv: boolean
  inEffectiveGmv: boolean
  inActualSignedAmount: boolean
  inRefundAmount: boolean
  inQualityReturn: boolean
}

export interface AmountCheckSummary {
  orderCount: number
  signedCount: number
  returnCount: number
  qualityReturnCount: number
  productGmvYuan: number
  effectiveGmvYuan: number
  actualSignedAmountYuan: number
  refundAmountYuan: number
  platformGrossProfitYuan: number | null
  signRate: number
  qualityReturnRate: number
  returnRate: number
}

function buildAmountNote(v: AnalyzedOrderView): string {
  if (v.gmvExcludeReason) return v.gmvExcludeReason
  if (v.isQualityReturn) return '品退订单，计入品退统计'
  if (v.isReturned) return '售后/退款订单，计入退款金额'
  if (v.isActualSigned) return '已签收，计入实际签收金额'
  if (v.effectiveGmvCent > 0) return '计入有效销售额'
  if (v.gmvCent > 0) return '计入总销售额 GMV'
  return '本期订单'
}

function viewToAmountCheckRow(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
): AmountCheckRow {
  const row = mapViewToBoardOrderRow(v)
  const inProductGmv = v.gmvCent > 0
  const inEffectiveGmv = v.effectiveGmvCent > 0
  const inActualSignedAmount = v.isActualSigned && v.actualSignedAmountCent > 0
  const inRefundAmount = v.isReturned && v.returnAmountCent > 0
  const inQualityReturn = v.isQualityReturn

  return {
    orderNo: row.orderNo,
    buyerNickname: row.buyerNickname,
    buyerId: row.buyerId,
    anchorName: row.anchorName,
    productName: row.productName,
    orderTime: row.orderTime,
    payAmount: row.payAmount,
    refundAmount: row.refundAmount,
    actualAmount: row.actualAmount,
    signedAmount: row.signedAmount,
    orderStatus: row.orderStatus,
    afterSaleStatus: row.afterSaleStatus,
    afterSaleReason: row.afterSaleReason,
    amountNote: buildAmountNote(v),
    statusText: row.statusText,
    inProductGmv,
    inEffectiveGmv,
    inActualSignedAmount,
    inRefundAmount,
    inQualityReturn,
  }
}

export async function buildAmountCheckReport(
  startDate: string,
  endDate: string,
  page = 1,
  pageSize = 100,
): Promise<{
  formulaVersion: string
  range: { startDate: string; endDate: string }
  summary: AmountCheckSummary
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: AmountCheckRow[]
}> {
  const range = resolveDateRange('custom', startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(range)
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const views = artifacts?.views ?? []
  const rawByMatch = new Map(
    (artifacts?.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )

  const allRows = views.map((v) => {
    const raw = rawByMatch.get(v.matchOrderId || v.orderId)
    return viewToAmountCheckRow(
      Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
    )
  })

  const metrics = aggregateViewsMetrics(views)

  let platformGrossProfitYuan: number | null = null
  if (artifacts?.settlement) {
    const orderAnchorByOrderId = new Map<string, string>()
    for (const v of views) {
      if (v.anchorId && v.matchOrderId) orderAnchorByOrderId.set(v.matchOrderId, v.anchorId)
    }
    const orderKeyIndex = buildOrderSettlementKeyIndex(
      artifacts.dedupe.uniqueOrders,
      orderAnchorByOrderId,
    )
    const gp = computeGrossProfitBreakdown(
      orderKeyIndex,
      sumEffectiveGmvCent(views),
      artifacts.settlement,
    )
    platformGrossProfitYuan = centToYuan(gp.grossProfitCent)
  }

  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.min(500, Math.max(1, Math.floor(pageSize)))
  const total = allRows.length
  const rows = allRows.slice((safePage - 1) * safeSize, safePage * safeSize)

  return {
    formulaVersion: AMOUNT_FORMULA_VERSION,
    range: { startDate: range.startDate, endDate: range.endDate },
    summary: {
      orderCount: metrics.orderCount,
      signedCount: metrics.signedCount,
      returnCount: metrics.returnCount,
      qualityReturnCount: metrics.qualityReturnCount,
      productGmvYuan: metrics.productGmv,
      effectiveGmvYuan: metrics.effectiveGmv,
      actualSignedAmountYuan: metrics.actualSignedAmount,
      refundAmountYuan: metrics.returnAmount,
      platformGrossProfitYuan,
      signRate: metrics.signRate ?? 0,
      qualityReturnRate: metrics.qualityReturnRate ?? 0,
      returnRate: metrics.returnRate ?? 0,
    },
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeSize)),
    },
    rows,
  }
}
