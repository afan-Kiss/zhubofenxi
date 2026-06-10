import type { AnalyzedOrderView } from '../types/analysis'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'

const CLOSED_KEYWORDS = ['已关闭', '交易关闭']

/** 异常单：已关闭 或 售后完成（仅提醒，不计入真实卖出） */
export function isDailyReportInvalidOrder(v: AnalyzedOrderView): boolean {
  const orderStatus = (v.orderStatusText ?? '').trim()
  const afterSale = (v.afterSaleStatusText ?? '').trim()
  if (CLOSED_KEYWORDS.some((k) => orderStatus.includes(k))) return true
  if (afterSale.includes('售后完成')) return true
  return false
}

/** 真实卖出：非异常单，且有效发货销售额 > 0（performance views 已排除低价刷单） */
export function isDailyReportSoldOrder(v: AnalyzedOrderView): boolean {
  if (isDailyReportInvalidOrder(v)) return false
  return v.includedInGmv === true && v.effectiveGmvCent > 0
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
