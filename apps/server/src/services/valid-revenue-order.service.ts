import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { isNoAfterSaleText, isPositiveAfterSaleText } from './after-sale-status-signal.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'

const VALID_ORDER_STATUS_RE = /已完成|已签收/

/** 售后取消类：客户取消售后，仍算有效成交 */
const AFTER_SALE_CANCEL_RE =
  /售后取消|买家取消售后|客户取消售后|售后已取消/

/** 无售后 / 未申请售后 — 与 isNoAfterSaleText 保持一致 */
function isEmptyAfterSaleStatus(afterSaleStatus: string): boolean {
  return isNoAfterSaleText(afterSaleStatus)
}

/** 售后处理中 / 已退款等：排除有效成交（售后状态优先于订单状态） */
const EXCLUDED_AFTER_SALE_RE =
  /售后处理中|待商家收货|待买家退货|退款中|退货退款中|售后完成|退款成功|退款完成|退货退款成功|已退款|部分退款|仅退款|退货退款|售后成功|售后中|退货完成|已退货/

const AFTER_SALE_PROCESSING_RE = /售后处理中|待商家收货|待买家退货|退款中|退货退款中/

/** 售后关闭 / 退款关闭：仅退款金额为 0 时可入池 */
const AFTER_SALE_CLOSED_RE = /售后关闭|退款关闭|关闭.*无退款/

export interface ValidRevenueExplanation {
  valid: boolean
  reason: string
}

export interface ValidRevenueUnknownSample {
  afterSaleStatus: string
  refundStatus: string
  orderStatus: string
  orderId: string
}

type UnknownCollector = Map<string, ValidRevenueUnknownSample[]>

let unknownAfterSaleCollector: UnknownCollector | null = null

/** 仅在验收/调试脚本中启用，线上默认不收集 */
export function enableValidRevenueUnknownCollector(): void {
  unknownAfterSaleCollector = new Map()
}

export function resetValidRevenueUnknownCollector(): void {
  unknownAfterSaleCollector = null
}

export function drainValidRevenueUnknownCollector(): Record<string, ValidRevenueUnknownSample[]> {
  if (!unknownAfterSaleCollector) return {}
  const out: Record<string, ValidRevenueUnknownSample[]> = {}
  for (const [status, samples] of unknownAfterSaleCollector.entries()) {
    out[status] = samples.slice(0, 5)
  }
  unknownAfterSaleCollector.clear()
  return out
}

function recordUnknownAfterSale(view: AnalyzedOrderView, afterSaleStatus: string): void {
  if (!unknownAfterSaleCollector) return
  const bucket = unknownAfterSaleCollector.get(afterSaleStatus) ?? []
  if (bucket.length >= 5) return
  bucket.push({
    afterSaleStatus,
    refundStatus: resolveRefundStatusText(view),
    orderStatus: normalizeText(view.orderStatusText),
    orderId: view.orderId || resolveMetricOrderNo(view) || '—',
  })
  unknownAfterSaleCollector.set(afterSaleStatus, bucket)
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

export function resolveAfterSaleStatusText(view: AnalyzedOrderView): string {
  return normalizeText(view.afterSaleStatusText || view.afterSaleStatusLabel)
}

function resolveRefundStatusText(view: AnalyzedOrderView): string {
  return normalizeText(
    (view as { refundStatusText?: string }).refundStatusText ??
      (view as { refundStatus?: string }).refundStatus,
  )
}

/** 订单退款金额（商品退款 / 退货退款 / 实际售后金额取最大） */
export function resolveValidRevenueRefundAmountCent(view: AnalyzedOrderView): number {
  return Math.max(
    view.productRefundAmountCent ?? 0,
    view.returnAmountCent ?? 0,
    view.realAfterSaleAmountCent ?? 0,
  )
}

function hasValidRevenueOrderStatus(view: AnalyzedOrderView): boolean {
  const orderStatus = normalizeText(view.orderStatusText)
  if (!orderStatus) return false
  return VALID_ORDER_STATUS_RE.test(orderStatus)
}

function hasRefundActivityFlags(view: AnalyzedOrderView): boolean {
  return Boolean(
    view.isReturnRefund ||
      view.isReturnRefundOrder ||
      view.isRealProductRefund ||
      view.isReturned,
  )
}

function explainRefundBlocked(refundCent: number, view: AnalyzedOrderView): ValidRevenueExplanation {
  if (refundCent > 0 || hasRefundActivityFlags(view)) {
    return { valid: false, reason: '已退款/退款成功' }
  }
  return { valid: true, reason: '无售后，计入有效成交' }
}

function explainAfterSaleStatus(
  afterSaleStatus: string,
  refundCent: number,
  view: AnalyzedOrderView,
): ValidRevenueExplanation | null {
  if (!afterSaleStatus) return null

  if (AFTER_SALE_CANCEL_RE.test(afterSaleStatus)) {
    if (refundCent > 0) {
      return { valid: false, reason: '售后已取消但存在退款金额' }
    }
    return { valid: true, reason: '客户取消售后，计入有效成交' }
  }

  if (isEmptyAfterSaleStatus(afterSaleStatus)) {
    return explainRefundBlocked(refundCent, view)
  }

  if (AFTER_SALE_PROCESSING_RE.test(afterSaleStatus)) {
    return { valid: false, reason: '售后处理中，货品可能正在退回' }
  }

  if (EXCLUDED_AFTER_SALE_RE.test(afterSaleStatus)) {
    return { valid: false, reason: '已退款/退款成功' }
  }

  if (AFTER_SALE_CLOSED_RE.test(afterSaleStatus)) {
    if (refundCent > 0) {
      return { valid: false, reason: '售后关闭但存在退款金额' }
    }
    return { valid: true, reason: '售后关闭且无退款，计入有效成交' }
  }

  recordUnknownAfterSale(view, afterSaleStatus)
  return { valid: false, reason: `未知售后状态（${afterSaleStatus}），暂不计入` }
}

function explainRefundStatus(
  refundStatus: string,
  refundCent: number,
  view: AnalyzedOrderView,
): ValidRevenueExplanation | null {
  if (!refundStatus) return null

  if (AFTER_SALE_CANCEL_RE.test(refundStatus)) {
    if (refundCent > 0) {
      return { valid: false, reason: '售后已取消但存在退款金额' }
    }
    return { valid: true, reason: '客户取消售后，计入有效成交' }
  }

  if (AFTER_SALE_PROCESSING_RE.test(refundStatus)) {
    return { valid: false, reason: '售后处理中，货品可能正在退回' }
  }

  if (EXCLUDED_AFTER_SALE_RE.test(refundStatus)) {
    return { valid: false, reason: '已退款/退款成功' }
  }

  if (AFTER_SALE_CLOSED_RE.test(refundStatus)) {
    if (refundCent > 0) {
      return { valid: false, reason: '售后关闭但存在退款金额' }
    }
    return { valid: true, reason: '售后关闭且无退款，计入有效成交' }
  }

  if (isPositiveAfterSaleText(refundStatus)) {
    recordUnknownAfterSale(view, refundStatus)
    return { valid: false, reason: `未知售后状态（${refundStatus}），暂不计入` }
  }

  return null
}

/**
 * 有效成交订单池：订单状态为已完成/已签收，且售后未在处理中/已退款。
 * 有效成交金额 = 对池内订单的 effectiveGmvCent 求和（不是成交减退款）。
 */
export function explainValidRevenueOrder(view: AnalyzedOrderView): ValidRevenueExplanation {
  if (!view.includedInGmv || view.effectiveGmvCent <= 0) {
    const excludeReason = normalizeText(view.gmvExcludeReason)
    if (excludeReason.includes('低价') || excludeReason.includes('刷单')) {
      return { valid: false, reason: '低价刷单订单，不计入有效成交' }
    }
    return { valid: false, reason: '订单未计入支付金额或成交金额为0' }
  }

  if (!hasValidRevenueOrderStatus(view)) {
    return { valid: false, reason: '订单状态不是已完成/已签收' }
  }

  const refundCent = resolveValidRevenueRefundAmountCent(view)
  const afterSaleStatus = resolveAfterSaleStatusText(view)
  const refundStatus = resolveRefundStatusText(view)

  const afterSaleExplain = explainAfterSaleStatus(afterSaleStatus, refundCent, view)
  if (afterSaleExplain) return afterSaleExplain

  const refundStatusExplain = explainRefundStatus(refundStatus, refundCent, view)
  if (refundStatusExplain) return refundStatusExplain

  const blocked = explainRefundBlocked(refundCent, view)
  if (!blocked.valid) return blocked

  return { valid: true, reason: '无售后，计入有效成交' }
}

export function isValidRevenueOrder(view: AnalyzedOrderView): boolean {
  return explainValidRevenueOrder(view).valid
}

export function resolveValidRevenueAmountCent(view: AnalyzedOrderView): number {
  return isValidRevenueOrder(view) ? view.effectiveGmvCent : 0
}

export function sumValidRevenueFromViews(views: AnalyzedOrderView[]): {
  validAmountCent: number
  validAmountYuan: number
  soldOrderCount: number
} {
  const deduped = dedupeViewsByMetricOrderNo(views)
  let validAmountCent = 0
  let soldOrderCount = 0
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (!isValidRevenueOrder(v)) continue
    validAmountCent += v.effectiveGmvCent
    soldOrderCount += 1
  }
  return {
    validAmountCent,
    validAmountYuan: centToYuan(validAmountCent),
    soldOrderCount,
  }
}
