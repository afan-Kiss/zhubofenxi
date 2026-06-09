import type {
  DuplicateOrderGroup,
  OrderDedupeResult,
  StandardOrder,
} from '../types/order'
import { addCent, sumCent } from './money'

function cloneOrder(order: StandardOrder): StandardOrder {
  return { ...order, errors: [...order.errors], raw: { ...order.raw } }
}

function mergeOrders(group: StandardOrder[]): StandardOrder {
  const base = cloneOrder(group[0])
  const cents = group.map((o) => o.gmvCent)
  const uniqueCents = [...new Set(cents)]
  const maxCent = Math.max(...cents)

  if (uniqueCents.length > 1) {
    base.errors.push('重复订单金额不一致')
    base.gmvCent = maxCent
    if (base.isSigned && !base.isRefunded) {
      base.effectiveSignedCent = maxCent
    } else {
      base.effectiveSignedCent = 0
    }
  }

  return base
}

export function dedupeOrders(orders: StandardOrder[]): OrderDedupeResult {
  const rawRowCount = orders.length
  const abnormalOrders: StandardOrder[] = []
  const validOrders: StandardOrder[] = []

  let missingOrderIdCount = 0
  let moneyParseFailCount = 0
  let timeParseFailCount = 0

  for (const order of orders) {
    const hasMissingId = !order.orderId
    const hasMoneyErr = order.errors.some((e) => e.includes('金额'))
    const hasTimeErr = order.errors.some((e) => e.includes('时间'))

    if (hasMissingId) missingOrderIdCount++
    if (hasMoneyErr) moneyParseFailCount++
    if (hasTimeErr) timeParseFailCount++

    if (hasMissingId || order.errors.length > 0) {
      abnormalOrders.push(cloneOrder(order))
    } else {
      validOrders.push(cloneOrder(order))
    }
  }

  const groups = new Map<string, StandardOrder[]>()
  for (const order of validOrders) {
    const list = groups.get(order.orderId) ?? []
    list.push(order)
    groups.set(order.orderId, list)
  }

  const uniqueOrders: StandardOrder[] = []
  const duplicateOrders: DuplicateOrderGroup[] = []

  for (const [orderId, list] of groups) {
    if (list.length === 1) {
      uniqueOrders.push(list[0])
      continue
    }

    const originalGmvCents = list.map((o) => o.gmvCent)
    const amountConsistent = new Set(originalGmvCents).size === 1
    const merged = mergeOrders(list)

    uniqueOrders.push(merged)
    duplicateOrders.push({
      orderId,
      count: list.length,
      amountConsistent,
      finalGmvCent: merged.gmvCent,
      originalGmvCents,
      sourceRowIndexes: list.map((o) => o.sourceRowIndex),
    })
  }

  const successCount = orders.filter((o) => o.errors.length === 0).length
  const totalGmvCent = sumCent(uniqueOrders.map((o) => o.gmvCent))
  const totalEffectiveSignedCent = sumCent(uniqueOrders.map((o) => o.effectiveSignedCent))

  return {
    uniqueOrders,
    duplicateOrders,
    abnormalOrders,
    summary: {
      rawRowCount,
      normalizedCount: orders.length,
      successCount,
      abnormalCount: abnormalOrders.length,
      uniqueOrderCount: uniqueOrders.length,
      duplicateOrderIdCount: duplicateOrders.length,
      missingOrderIdCount,
      moneyParseFailCount,
      timeParseFailCount,
      totalGmvCent,
      totalEffectiveSignedCent,
    },
  }
}

export function addSummaryCent(a: number, b: number): number {
  return addCent(a, b)
}
