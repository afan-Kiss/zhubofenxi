import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { isLowPriceBrushOrderView } from './low-price-brush-order.service'
import { isActualAfterSaleOrder } from './operations-after-sale-order.util'

const CLOSED_KEYWORDS = ['已关闭', '交易关闭']

function normalizeOrderStatus(view: AnalyzedOrderView): string {
  return (view.orderStatusText ?? '').trim()
}

/** 关闭/退货单：已关闭，或存在售后/退款（与真实发货剔除口径一致） */
export function isDailyReportInvalidOrder(v: AnalyzedOrderView): boolean {
  const orderStatus = normalizeOrderStatus(v)
  if (CLOSED_KEYWORDS.some((k) => orderStatus.includes(k))) return true
  return isActualAfterSaleOrder(v)
}

/**
 * 真实发货计入订单：主播业绩内订单，剔除低价刷单与售后订单。
 * 金额取支付基数 paymentBaseCent（与主播业绩支付金额一致）。
 */
export function isDailyReportShippedOrder(v: AnalyzedOrderView): boolean {
  if (!v.includedInGmv) return false
  if (isLowPriceBrushOrderView(v)) return false
  if (isActualAfterSaleOrder(v)) return false
  return (v.paymentBaseCent ?? 0) > 0
}

/** 真实卖出单数（与真实发货金额同一订单池） */
export function isDailyReportSoldOrder(v: AnalyzedOrderView): boolean {
  return isDailyReportShippedOrder(v)
}

/** 真实发货金额：当天主播业绩合计，去除售后订单 */
export function sumDailyReportShippedFromViews(views: AnalyzedOrderView[]): {
  shippedAmountCent: number
  shippedAmountYuan: number
  soldOrderCount: number
} {
  const deduped = dedupeViewsByMetricOrderNo(views)
  let shippedAmountCent = 0
  let soldOrderCount = 0
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (!isDailyReportShippedOrder(v)) continue
    shippedAmountCent += v.paymentBaseCent
    soldOrderCount += 1
  }
  return {
    shippedAmountCent,
    shippedAmountYuan: Math.round(centToYuan(shippedAmountCent)),
    soldOrderCount,
  }
}

export function countDailyReportOrders(views: AnalyzedOrderView[]): {
  soldOrderCount: number
  invalidOrderCount: number
} {
  const deduped = dedupeViewsByMetricOrderNo(views)
  let soldOrderCount = 0
  let invalidOrderCount = 0
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (isDailyReportInvalidOrder(v)) {
      invalidOrderCount += 1
      continue
    }
    if (isDailyReportSoldOrder(v)) {
      soldOrderCount += 1
    }
  }
  return { soldOrderCount, invalidOrderCount }
}

export function safeRatioPercent(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0 || part < 0) return null
  return Math.round((part / total) * 100)
}

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null
  }
  const v = numerator / denominator
  return Number.isFinite(v) ? v : null
}

export function roundYuan(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value)
}

export function roundMinutes(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value)
}
