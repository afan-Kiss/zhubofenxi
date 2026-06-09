import type { NormalizedOrder } from '../types/analysis'
import { getMonthKey } from '../utils/time'

export function isValidOrderDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

/** 统计用下单时间：支付时间优先，其次下单时间字段 */
export function resolveMetricOrderTime(order: NormalizedOrder): Date | null {
  for (const candidate of [order.paymentTime, order.orderedAt, order.orderTime]) {
    if (isValidOrderDate(candidate)) return candidate
  }
  return null
}

export function partitionOrdersByResolvableTime(orders: NormalizedOrder[]): {
  validOrders: NormalizedOrder[]
  abnormalOrders: NormalizedOrder[]
} {
  const validOrders: NormalizedOrder[] = []
  const abnormalOrders: NormalizedOrder[] = []
  for (const o of orders) {
    const resolved = resolveMetricOrderTime(o)
    if (resolved) {
      validOrders.push({
        ...o,
        orderTime: resolved,
        monthKey: getMonthKey(resolved),
      })
    } else {
      abnormalOrders.push(o)
    }
  }
  return { validOrders, abnormalOrders }
}

export function abnormalOrderDisplayNo(order: NormalizedOrder): string {
  return (
    order.displayOrderNo ||
    order.officialOrderNo ||
    order.packageId ||
    order.bizOrderId ||
    order.orderId ||
    ''
  ).trim()
}
