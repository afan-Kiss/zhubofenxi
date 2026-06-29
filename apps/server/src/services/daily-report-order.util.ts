import type { AnalyzedOrderView } from '../types/analysis'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import {
  isValidRevenueOrder,
  resolveAfterSaleStatusText,
  resolveValidRevenueRefundAmountCent,
} from './valid-revenue-order.service'

const CLOSED_KEYWORDS = ['已关闭', '交易关闭']
const EXCLUDED_AFTER_SALE_FOR_INVALID_RE =
  /售后完成|退款成功|退款完成|已退款|退货退款成功|售后处理中|待商家收货|待买家退货|退款中|退货退款中|部分退款|仅退款|退货退款|售后成功|售后中|退货完成|已退货/

function normalizeOrderStatus(view: AnalyzedOrderView): string {
  return (view.orderStatusText ?? '').trim()
}

/** 关闭/退货单：已关闭，或存在需提醒的售后/退款状态（不计入有效成交） */
export function isDailyReportInvalidOrder(v: AnalyzedOrderView): boolean {
  const orderStatus = normalizeOrderStatus(v)
  if (CLOSED_KEYWORDS.some((k) => orderStatus.includes(k))) return true

  const afterSale = resolveAfterSaleStatusText(v)
  if (afterSale && EXCLUDED_AFTER_SALE_FOR_INVALID_RE.test(afterSale)) return true

  if (resolveValidRevenueRefundAmountCent(v) > 0 && !isValidRevenueOrder(v)) return true

  return false
}

/** 有效成交订单（与运营报表 / 日报 / 下钻同一口径） */
export function isDailyReportSoldOrder(v: AnalyzedOrderView): boolean {
  return isValidRevenueOrder(v)
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
