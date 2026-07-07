import type { NormalizedOrder, SettlementRecord } from '../types/analysis'

const EMPTY_KEYS = new Set(['', '-', '—', 'null', 'undefined'])

function normalizeKey(raw: unknown): string | null {
  if (raw == null) return null
  const t = String(raw).trim()
  if (EMPTY_KEYS.has(t)) return null
  return t
}

/** P 前缀缺失/存在变体，用于结算与订单交叉匹配 */
export function expandSettlementMatchKeyVariants(key: string): string[] {
  const base = normalizeKey(key)
  if (!base) return []
  const variants = new Set<string>([base])
  const withoutP = base.replace(/^P/i, '')
  if (withoutP && withoutP !== base) variants.add(withoutP)
  if (!/^P/i.test(base)) {
    if (/^\d+$/.test(base)) variants.add(`P${base}`)
    else if (/^\d/.test(base)) variants.add(`P${base}`)
  }
  return [...variants]
}

function addKeyVariants(target: Set<string>, raw: unknown): void {
  const base = normalizeKey(raw)
  if (!base) return
  for (const v of expandSettlementMatchKeyVariants(base)) target.add(v)
}

function pickBillFieldRaw(map: Record<string, unknown>, code: string): unknown {
  const field = map[code]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value !== undefined && f.value !== null && String(f.value).trim() !== '') return f.value
    if (f.displayValue !== undefined && f.displayValue !== null) return f.displayValue
  }
  return undefined
}

function extractSettleBillMap(item: Record<string, unknown>): Record<string, unknown> {
  const bill = item.settleBill
  if (!Array.isArray(bill)) return item
  const map: Record<string, unknown> = {}
  for (const entry of bill) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const code = e.code != null ? String(e.code) : ''
    if (code) map[code] = e
  }
  return map
}

export function collectOrderSettlementMatchKeys(order: NormalizedOrder): string[] {
  const keys = new Set<string>()
  for (const field of [
    order.orderId,
    order.packageId,
    order.bizOrderId,
    order.matchOrderId,
    order.displayOrderNo,
    order.officialOrderNo,
  ]) {
    addKeyVariants(keys, field)
  }
  return [...keys]
}

export function collectSettlementRecordMatchKeys(record: SettlementRecord): string[] {
  const keys = new Set<string>()
  addKeyVariants(keys, record.orderId)

  const raw = record.raw ?? {}
  const map = extractSettleBillMap(raw)
  for (const code of ['PACKAGE_ID', 'SETTLE_NO', 'ORDER_NO', 'ORDER_ID', 'PACKAGE_NO']) {
    addKeyVariants(keys, pickBillFieldRaw(map, code))
  }
  for (const field of [
    'packageId',
    'packageNo',
    'settleNo',
    'orderNo',
    'orderId',
    'order_id',
    'package_id',
  ]) {
    addKeyVariants(keys, raw[field])
  }
  return [...keys]
}

export interface OrderSettlementKeyIndex {
  keyToCanonicalOrderId: Map<string, string>
  canonicalOrderIds: Set<string>
  anchorByCanonicalOrderId: Map<string, string>
}

export function buildOrderSettlementKeyIndex(
  orders: NormalizedOrder[],
  anchorByMatchOrderId: Map<string, string>,
): OrderSettlementKeyIndex {
  const keyToCanonicalOrderId = new Map<string, string>()
  const canonicalOrderIds = new Set<string>()
  const anchorByCanonicalOrderId = new Map<string, string>()

  for (const order of orders) {
    const canonical =
      normalizeKey(order.matchOrderId) ||
      normalizeKey(order.packageId) ||
      normalizeKey(order.displayOrderNo) ||
      normalizeKey(order.orderId)
    if (!canonical) continue
    canonicalOrderIds.add(canonical)

    const anchorId =
      anchorByMatchOrderId.get(order.matchOrderId) ||
      anchorByMatchOrderId.get(canonical) ||
      anchorByMatchOrderId.get(order.packageId) ||
      anchorByMatchOrderId.get(order.orderId)
    if (anchorId) anchorByCanonicalOrderId.set(canonical, anchorId)

    for (const key of collectOrderSettlementMatchKeys(order)) {
      if (!keyToCanonicalOrderId.has(key)) {
        keyToCanonicalOrderId.set(key, canonical)
      }
    }
  }

  return { keyToCanonicalOrderId, canonicalOrderIds, anchorByCanonicalOrderId }
}

export function resolveSettlementRecordCanonicalOrderId(
  record: SettlementRecord,
  index: OrderSettlementKeyIndex,
): string | null {
  for (const key of collectSettlementRecordMatchKeys(record)) {
    const canonical = index.keyToCanonicalOrderId.get(key)
    if (canonical) return canonical
  }
  return null
}
