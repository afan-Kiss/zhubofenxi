/**
 * 买家详情 / 排行：官方真实实付金额（禁止商品标价 / 应收 / payAmount 兜底）
 */
import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'
import { parseMoneyToCent } from '../utils/money'
import {
  hasOrderPaymentTime,
  isOrderCancelled,
  isOrderUnpaid,
} from './order-amount-metrics.service'

export type PaidAmountSource =
  | 'official_actual_pay'
  | 'official_pay_amount'
  | 'fallback_zero_cancelled'
  | 'fallback_zero_unpaid'
  | 'fallback_zero_no_pay_time'
  | 'fallback_zero_closed'
  | 'missing_paid_field'
  | 'invalid_product_price_fallback_blocked'

/** 仅买家真实实付字段，不含 payAmount / orderAmount / receivable */
const BUYER_ACTUAL_PAID_RAW_KEYS = [
  'actualPaid',
  'actualPaidWithoutDeposit',
  'actual_paid',
  'buyerPaidAmount',
  'buyerPayAmount',
  'realPayAmount',
] as const

const CLOSED_KEYWORDS = ['已关闭', '交易关闭']
const UNPAID_KEYWORDS = ['待付款', '未支付', '待支付']

function pickCentFromRaw(raw: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = raw[k]
    if (v == null || v === '') continue
    const parsed = parseMoneyToCent(v)
    if (parsed.ok) return parsed.cent
  }
  return null
}

function orderHasPayTime(
  order: NormalizedOrder | (AnalyzedOrderView & { raw?: Record<string, unknown> }),
): boolean {
  if ('paymentTime' in order && order.paymentTime instanceof Date) {
    return !Number.isNaN(order.paymentTime.getTime())
  }
  const raw = order.raw
  if (!raw || typeof raw !== 'object') return false
  for (const k of ['payTime', 'pay_time', 'paidTime', 'paid_time', 'paymentTime', 'payment_time']) {
    const v = (raw as Record<string, unknown>)[k]
    if (v == null || v === '' || v === 0) continue
    return true
  }
  return false
}

function isClosedOrderStatus(text: string): boolean {
  return CLOSED_KEYWORDS.some((k) => text.includes(k))
}

function isUnpaidStatusText(text: string): boolean {
  return UNPAID_KEYWORDS.some((k) => text.includes(k))
}

function asNormalized(order: NormalizedOrder | AnalyzedOrderView): NormalizedOrder {
  return order as NormalizedOrder
}

function pickActualPaidCentFromOrder(
  order: NormalizedOrder | (AnalyzedOrderView & { raw?: Record<string, unknown> }),
): number | null {
  if (order.actualPaidCent > 0) return order.actualPaidCent
  const raw = order.raw
  if (raw && typeof raw === 'object') {
    const fromRaw = pickCentFromRaw(raw as Record<string, unknown>, BUYER_ACTUAL_PAID_RAW_KEYS)
    if (fromRaw != null) return fromRaw
  }
  if (order.actualPaidCent === 0) return 0
  return null
}

/**
 * 买家 Drawer / 排行专用真实实付（不影响经营总览 paymentBaseCent / GMV）
 */
export function resolveOfficialPaidAmountCent(
  order: NormalizedOrder | (AnalyzedOrderView & { raw?: Record<string, unknown> }),
): { cent: number; source: PaidAmountSource; confirmed: boolean } {
  const status = (order.orderStatusText ?? '').trim()
  const cancelled = isOrderCancelled(asNormalized(order)) || /已取消|取消/.test(status)
  const closed = isClosedOrderStatus(status)
  const unpaid =
    isOrderUnpaid(asNormalized(order)) || isUnpaidStatusText(status)
  const hasPayTime = orderHasPayTime(order) || hasOrderPaymentTime(asNormalized(order))
  const actualPaid = pickActualPaidCentFromOrder(order)

  if (cancelled && !hasPayTime) {
    return { cent: 0, source: 'fallback_zero_cancelled', confirmed: false }
  }
  if (closed && !hasPayTime) {
    return { cent: 0, source: 'fallback_zero_closed', confirmed: false }
  }
  if (unpaid && !hasPayTime) {
    return { cent: 0, source: 'fallback_zero_unpaid', confirmed: false }
  }

  if (actualPaid === 0 && (cancelled || closed || unpaid)) {
    return {
      cent: 0,
      source: cancelled ? 'fallback_zero_cancelled' : closed ? 'fallback_zero_closed' : 'fallback_zero_unpaid',
      confirmed: false,
    }
  }

  if (actualPaid != null && actualPaid > 0) {
    if ((cancelled || closed) && !hasPayTime) {
      return { cent: 0, source: 'fallback_zero_cancelled', confirmed: false }
    }
    return { cent: actualPaid, source: 'official_actual_pay', confirmed: true }
  }

  const productOrReceivable =
    order.receivableAmountCent ||
    order.productAmountCent ||
    order.gmvCent ||
    0
  if (productOrReceivable > 0 && (actualPaid == null || actualPaid === 0)) {
    return {
      cent: 0,
      source: 'invalid_product_price_fallback_blocked',
      confirmed: false,
    }
  }

  if (!hasPayTime) {
    return { cent: 0, source: 'fallback_zero_no_pay_time', confirmed: false }
  }

  return { cent: 0, source: 'missing_paid_field', confirmed: false }
}
