import type { AnalyzedOrderView } from '../types/analysis'
import {
  isNoAfterSaleText,
  isPositiveAfterSaleText,
} from './after-sale-status-signal.service'
import { normalizeAfterSalesReason } from './after-sales-reason-normalize.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo, calcRefundRate } from './calc-refund-rate.service'
import { viewCountsAsPaidOrder } from './business-metrics.service'
import { viewCountsAsRefundOrder } from './order-refund-metrics.service'

export interface OperationsRefundMetrics {
  paidOrderCount: number
  refundOrderCount: number
  rate: number | null
}

/** 运营报表：选定范围内退款单数 / 支付单数（与经营看板退款率口径一致） */
export function computeOperationsRefundMetricsFromViews(
  views: AnalyzedOrderView[],
): OperationsRefundMetrics {
  const deduped = dedupeViewsByMetricOrderNo(views)
  const paidOrderNos: string[] = []
  const refundOrderNos: string[] = []
  for (const v of deduped) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    if (viewCountsAsPaidOrder(v)) paidOrderNos.push(no)
    if (viewCountsAsRefundOrder(v)) refundOrderNos.push(no)
  }
  const result = calcRefundRate({ paidOrderNos, refundOrderNos })
  return {
    paidOrderCount: result.paidOrderCount,
    refundOrderCount: result.refundOrderCount,
    rate: result.refundRate,
  }
}

export function countOperationsRefundOrders(views: AnalyzedOrderView[]): number {
  return computeOperationsRefundMetricsFromViews(views).refundOrderCount
}

function resolveRefundStatusText(view: AnalyzedOrderView): string {
  return String(
    (view as { refundStatusText?: string }).refundStatusText ??
      (view as { refundStatus?: string }).refundStatus ??
      '',
  ).trim()
}

function resolveAfterSaleStatusText(view: AnalyzedOrderView): string {
  return String(view.afterSaleStatusText || view.afterSaleStatusLabel || '').trim()
}

function statusTextSignalsAfterSale(text: string): boolean | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (isNoAfterSaleText(trimmed)) return false
  if (isPositiveAfterSaleText(trimmed)) return true
  return null
}

/** 订单是否发生实际退款/退货/售后（用于下钻过滤） */
export function isActualAfterSaleOrder(view: AnalyzedOrderView): boolean {
  if (view.isFreightRefundOnly) {
    return false
  }
  if ((view.productRefundAmountCent ?? 0) > 0) return true
  if ((view.returnAmountCent ?? 0) > 0) return true
  if ((view.realAfterSaleAmountCent ?? 0) > 0) return true
  if (view.isReturnRefund || view.isReturnRefundOrder || view.isRealProductRefund) return true
  if (view.isReturned) return true

  const refundSignal = statusTextSignalsAfterSale(resolveRefundStatusText(view))
  if (refundSignal === true) return true

  const afterSaleSignal = statusTextSignalsAfterSale(resolveAfterSaleStatusText(view))
  if (afterSaleSignal === true) return true
  if (afterSaleSignal === false) return false
  if (refundSignal === false) return false

  return false
}

export function hasAfterSaleActivity(view: AnalyzedOrderView): boolean {
  return isActualAfterSaleOrder(view)
}

/** 售后原因展示：无售后为空；有售后无原因显示「未填写原因」 */
export function formatAfterSalesReasonDisplay(
  view: AnalyzedOrderView,
  reasonRaw: string,
): string | null {
  const text = (reasonRaw ?? '').trim()
  if (!hasAfterSaleActivity(view)) {
    return text || null
  }
  if (!text) return '未填写原因'
  return text
}

/** 售后原因分类标签（仅在有售后时展示，空值不映射为「其他」） */
export function formatAfterSalesCategoryLabel(
  view: AnalyzedOrderView,
  reasonRaw: string,
): string | null {
  if (!hasAfterSaleActivity(view)) return null
  const text = (reasonRaw ?? '').trim()
  if (!text) return null
  const normalized = normalizeAfterSalesReason(text)
  if (normalized.category === 'other') return text
  return normalized.categoryLabel
}

export function formatAfterSaleStatusDisplay(view: AnalyzedOrderView): string | null {
  if (!hasAfterSaleActivity(view)) return null
  const status = String(view.afterSaleStatusText || view.afterSaleStatusLabel || '').trim()
  return status || null
}

/** 退货单率（订单维度，0~1）：退款订单数 / 支付订单数 */
export function computeReturnOrderRateRatio(
  paidOrderCount: number,
  refundOrderCount: number,
): number | null {
  if (paidOrderCount <= 0) return null
  const rate = refundOrderCount / paidOrderCount
  if (rate > 1) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[operations] 退货单率超过 100%：refund=${refundOrderCount} paid=${paidOrderCount} rate=${rate.toFixed(4)}`,
      )
    }
  }
  return rate
}

export function isReturnOrderRateAbnormal(rate: number | null | undefined): boolean {
  return rate != null && Number.isFinite(rate) && rate > 1
}

/** 售后原因榜 / 下钻：统一 reason 解析顺序 */
export function resolveOperationsAfterSalesReasonRaw(view: AnalyzedOrderView): string {
  return (
    view.afterSalesWorkbenchReason?.trim() ||
    view.finalAfterSaleReason?.trim() ||
    view.afterSaleReasonText?.trim() ||
    view.reasonText?.trim() ||
    view.afterSaleStatusText?.trim() ||
    view.afterSaleStatusLabel?.trim() ||
    ''
  )
}

/** 是否计入运营报表售后原因榜（排除纯运费补偿） */
export function viewCountsAsOperationsAfterSalesReasonOrder(view: AnalyzedOrderView): boolean {
  if (view.isFreightRefundOnly) return false
  return isActualAfterSaleOrder(view)
}

/** 运营报表售后退款金额（分）：商品退款 / 退货 / 实际售后金额取最大，排除纯运费 */
export function resolveOperationsAfterSalesRefundAmountCent(view: AnalyzedOrderView): number {
  if (view.isFreightRefundOnly) return 0
  return Math.max(
    view.productRefundAmountCent ?? 0,
    view.returnAmountCent ?? 0,
    view.realAfterSaleAmountCent ?? 0,
  )
}
