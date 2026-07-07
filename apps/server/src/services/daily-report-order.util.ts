import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { pickProductName } from './order-row-mapper.service'
import { isLowPriceBrushOrderView } from './low-price-brush-order.service'
import { isActualAfterSaleOrder } from './operations-after-sale-order.util'

const CLOSED_OR_CANCELLED_KEYWORDS = ['已关闭', '交易关闭', '已取消', '交易取消']

function normalizeOrderStatus(view: AnalyzedOrderView): string {
  return (view.orderStatusText ?? '').trim()
}

function isDailyReportClosedOrCancelledOrder(v: AnalyzedOrderView): boolean {
  const orderStatus = normalizeOrderStatus(v)
  return CLOSED_OR_CANCELLED_KEYWORDS.some((k) => orderStatus.includes(k))
}

/**
 * 关闭/退货单：已关闭/已取消，或存在售后/退款（与真实发货剔除口径一致）。
 * 注意：有效成交口径中「售后关闭且无退款」仍可能计入 validRevenue；
 * 但日报真实发货按「只要进过售后流程即剔除」处理，两者 intentionally 不同。
 */
export function isDailyReportInvalidOrder(v: AnalyzedOrderView): boolean {
  if (isDailyReportClosedOrCancelledOrder(v)) return true
  return isActualAfterSaleOrder(v)
}

/**
 * 真实发货计入订单：主播业绩内订单，剔除低价刷单、售后与关闭/取消单。
 * 金额取支付基数 paymentBaseCent（与主播业绩支付金额一致）。
 */
export function isDailyReportShippedOrder(v: AnalyzedOrderView): boolean {
  if (!v.includedInGmv) return false
  if (isLowPriceBrushOrderView(v)) return false
  if (isDailyReportInvalidOrder(v)) return false
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
    shippedAmountYuan: roundMoneyYuan(centToYuan(shippedAmountCent)),
    soldOrderCount,
  }
}

export interface DailyReportShippedOrderLine {
  orderNo: string
  productTitle: string
  amountYuan: number
  anchorName?: string
}

function pickProductTitleFromView(v: AnalyzedOrderView): string {
  const raw = (v as AnalyzedOrderView & { raw?: Record<string, unknown> }).raw
  const title = pickProductName(raw)
  return title && title !== '—' ? title : '商品名称未同步'
}

export function sortDailyReportShippedOrders(
  lines: DailyReportShippedOrderLine[],
): DailyReportShippedOrderLine[] {
  return [...lines].sort((a, b) => {
    const anchorCmp = (a.anchorName ?? '').localeCompare(b.anchorName ?? '', 'zh-CN')
    if (anchorCmp !== 0) return anchorCmp
    return (a.productTitle ?? '').localeCompare(b.productTitle ?? '', 'zh-CN')
  })
}

/** 真实发货订单明细（与 sumDailyReportShippedFromViews 同一订单池） */
export function listDailyReportShippedOrders(
  views: AnalyzedOrderView[],
  anchorName?: string,
): DailyReportShippedOrderLine[] {
  const deduped = dedupeViewsByMetricOrderNo(views)
  const lines: DailyReportShippedOrderLine[] = []
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (!isDailyReportShippedOrder(v)) continue
    const orderNo = resolveMetricOrderNo(v) || String(v.orderId ?? '').trim()
    if (!orderNo) continue
    const resolvedAnchorName = (anchorName ?? v.anchorName ?? '').trim()
    lines.push({
      orderNo,
      productTitle: pickProductTitleFromView(v),
      amountYuan: Math.round(centToYuan(v.paymentBaseCent) * 100) / 100,
      ...(resolvedAnchorName ? { anchorName: resolvedAnchorName } : {}),
    })
  }
  return sortDailyReportShippedOrders(lines)
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

/** 金额保留两位小数（元），与 formatMoney 展示一致 */
export function roundMoneyYuan(value: number): number {
  return Math.round(value * 100) / 100
}

export function roundMinutes(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value)
}
