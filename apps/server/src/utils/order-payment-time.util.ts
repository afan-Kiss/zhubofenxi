import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'
import { formatDateTime } from '../utils/time'

const RAW_PAYMENT_TIME_KEYS = [
  'payTime',
  'pay_time',
  'paymentTime',
  'payment_time',
  'paidTime',
  'paid_time',
  'paidAt',
  'paid_at',
] as const

function pickStringFromRaw(raw: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (v == null || v === '') continue
    const s = String(v).trim()
    if (s) return s
  }
  return ''
}

/** 导出 / 核验用：优先 normalized paymentTime，其次 raw 支付时间字段 */
export function pickPaymentTimeText(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  order?: NormalizedOrder | null,
): string {
  const paymentTime = order?.paymentTime ?? null
  if (paymentTime && !Number.isNaN(paymentTime.getTime())) {
    return formatDateTime(paymentTime)
  }
  const raw = view.raw
  if (raw) {
    const fromRaw = pickStringFromRaw(raw, RAW_PAYMENT_TIME_KEYS)
    if (fromRaw) return fromRaw
  }
  return '—'
}

export function hasPaymentTimeText(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  order?: NormalizedOrder | null,
): boolean {
  return pickPaymentTimeText(view, order) !== '—'
}
