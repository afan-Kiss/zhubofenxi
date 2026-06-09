import type { DuplicateOrderGroup, NormalizedOrder, OrderDedupeResult } from '../types/analysis'
import { sumCent } from '../utils/money'

function cloneOrder(order: NormalizedOrder): NormalizedOrder {
  return { ...order, errors: [...order.errors], raw: { ...order.raw } }
}

function pickString(raw: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = raw[key]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

/** 单行 SKU 标识；包裹内 skus 数组视为已合并，不参与行级去重 */
function lineSkuKey(order: NormalizedOrder): string {
  const raw = order.raw
  if (Array.isArray(raw.skus) && raw.skus.length > 0) {
    return '__package_merged__'
  }
  return pickString(raw, ['skuId', 'sku_id']) || '__single_line__'
}

function sumAmountFields(orders: NormalizedOrder[]): NormalizedOrder {
  const base = cloneOrder(orders[0])
  base.gmvCent = sumCent(orders.map((o) => o.gmvCent))
  base.productAmountCent = sumCent(orders.map((o) => o.productAmountCent))
  base.receivableAmountCent = sumCent(orders.map((o) => o.receivableAmountCent))
  base.freightCent = sumCent(orders.map((o) => o.freightCent))
  base.platformDiscountCent = sumCent(orders.map((o) => o.platformDiscountCent))
  base.actualPaidCent = sumCent(orders.map((o) => o.actualPaidCent))
  base.actualSellerReceiveAmountCent = sumCent(orders.map((o) => o.actualSellerReceiveAmountCent))
  base.actualSignedAmountCent = sumCent(orders.map((o) => o.actualSignedAmountCent))

  base.isSigned = orders.some((o) => o.isSigned)
  base.isReturned = orders.some((o) => o.isReturned)
  base.isQualityReturn = orders.some((o) => o.isQualityReturn)
  base.actualSigned = orders.some((o) => o.actualSigned)

  const gmvs = orders.map((o) => o.gmvCent)
  if (new Set(gmvs).size > 1) {
    base.errors.push('同包裹多 SKU 行金额已累加')
  }
  return base
}

function mergeMatchOrderGroup(group: NormalizedOrder[]): NormalizedOrder {
  if (group.length === 1) return group[0]

  const bySku = new Map<string, NormalizedOrder[]>()
  for (const o of group) {
    const sk = lineSkuKey(o)
    const list = bySku.get(sk) ?? []
    list.push(o)
    bySku.set(sk, list)
  }

  const mergedLines: NormalizedOrder[] = []
  for (const [, skuGroup] of bySku) {
    if (skuGroup.length === 1) {
      mergedLines.push(skuGroup[0])
      continue
    }
    const skuIds = skuGroup.map(lineSkuKey)
    if (skuIds.every((id) => id === skuIds[0])) {
      mergedLines.push(skuGroup[0])
    } else {
      mergedLines.push(sumAmountFields(skuGroup))
    }
  }

  if (mergedLines.length === 1) return mergedLines[0]
  return sumAmountFields(mergedLines)
}

export function dedupeOrders(orders: NormalizedOrder[]): OrderDedupeResult {
  const abnormalOrders: NormalizedOrder[] = []
  const validOrders: NormalizedOrder[] = []

  for (const order of orders) {
    if (!order.matchOrderId || order.errors.length > 0) {
      abnormalOrders.push(cloneOrder(order))
    } else {
      validOrders.push(cloneOrder(order))
    }
  }

  const groups = new Map<string, NormalizedOrder[]>()
  for (const order of validOrders) {
    const key = order.matchOrderId
    const list = groups.get(key) ?? []
    list.push(order)
    groups.set(key, list)
  }

  const uniqueOrders: NormalizedOrder[] = []
  const duplicateOrders: DuplicateOrderGroup[] = []

  for (const [matchOrderId, list] of groups) {
    if (list.length === 1) {
      uniqueOrders.push(list[0])
      continue
    }

    const originalGmvCents = list.map((o) => o.gmvCent)
    const merged = mergeMatchOrderGroup(list)
    uniqueOrders.push(merged)
    duplicateOrders.push({
      orderId: matchOrderId,
      count: list.length,
      amountConsistent: new Set(originalGmvCents).size === 1,
      finalGmvCent: merged.gmvCent,
      originalGmvCents,
      sourceRowIndexes: list.map((o) => o.sourceRowIndex),
    })
  }

  return {
    uniqueOrders,
    duplicateOrders,
    abnormalOrders,
    summary: {
      rawRowCount: orders.length,
      uniqueOrderCount: uniqueOrders.length,
      abnormalCount: abnormalOrders.length,
      totalGmvCent: sumCent(uniqueOrders.map((o) => o.gmvCent)),
    },
  }
}
