import type { AnalyzedOrderView } from '../types/analysis'
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

const REFUND_STATUS_RE =
  /退款中|退款成功|退货退款|已退款|售后成功|售后中|售后完成|退货完成|退款完成/i
const NO_AFTER_SALE_STATUS_RE = /无售后|未售后|无退款|关闭.*无退款|售后关闭/i

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

  const refundStatus = String(
    (view as { refundStatusText?: string }).refundStatusText ??
      (view as { refundStatus?: string }).refundStatus ??
      '',
  ).trim()
  if (refundStatus && REFUND_STATUS_RE.test(refundStatus)) return true

  const afterSaleStatus = String(
    view.afterSaleStatusText || view.afterSaleStatusLabel || '',
  ).trim()
  if (afterSaleStatus) {
    if (NO_AFTER_SALE_STATUS_RE.test(afterSaleStatus)) return false
    if (REFUND_STATUS_RE.test(afterSaleStatus)) return true
    if (/售后|退款|退货/.test(afterSaleStatus)) return true
  }

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
