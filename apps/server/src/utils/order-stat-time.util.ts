import type { NormalizedOrder } from '../types/analysis'
import type { DateRangeResolved } from './date-range'

/** 支付时间是否在范围内（支付金额 / 支付订单数主口径） */
export function orderPayTimeInRange(
  order: NormalizedOrder,
  range: DateRangeResolved,
): boolean {
  const t = order.paymentTime
  if (!t) return false
  const ms = t.getTime()
  if (Number.isNaN(ms)) return false
  return ms >= range.startTimeMs && ms <= range.endTimeMs
}

/** 统计归属时间：优先支付时间，无则下单时间（非支付指标兜底） */
export function orderStatTimeMs(order: NormalizedOrder): number | null {
  const t = order.paymentTime ?? order.orderedAt ?? order.orderTime
  if (!t) return null
  const ms = t.getTime()
  return Number.isNaN(ms) ? null : ms
}

export function orderStatTimeInRange(
  order: NormalizedOrder,
  range: DateRangeResolved,
): boolean {
  const ms = orderStatTimeMs(order)
  if (ms == null) return false
  return ms >= range.startTimeMs && ms <= range.endTimeMs
}
