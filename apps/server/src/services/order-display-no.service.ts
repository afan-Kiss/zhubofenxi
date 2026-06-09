import type { AnalyzedOrderView } from '../types/analysis'

/**
 * 官方订单号展示（全站 Drawer / 导出 / 列表统一）
 * 禁止 Number / parseInt / 仅提取数字；大整数 JSON number 不参与展示候选。
 */

const FLAT_ORDER_KEYS: Array<{ keys: string[]; source: string }> = [
  { keys: ['orderSn', 'order_sn'], source: 'orderSn' },
  { keys: ['orderNumber', 'order_number'], source: 'orderNumber' },
  { keys: ['officialOrderNo', 'official_order_no'], source: 'officialOrderNo' },
  { keys: ['orderNo', 'order_no'], source: 'orderNo' },
  { keys: ['packageId', 'package_id'], source: 'packageId' },
  { keys: ['packageNo', 'package_no'], source: 'packageNo' },
  { keys: ['orderId', 'order_id'], source: 'orderId' },
]

const NESTED_OBJECTS = [
  'orderInfo',
  'order_info',
  'packageInfo',
  'package_info',
  'tradeOrder',
  'trade_order',
  'baseInfo',
  'base_info',
]

export type OrderDisplayNoSource =
  | 'orderSn'
  | 'orderNumber'
  | 'officialOrderNo'
  | 'orderNo'
  | 'orderId'
  | 'packageId'
  | 'packageNo'
  | 'nested'
  | 'dbPackageId'
  | 'dbOrderId'
  | 'hintPackageId'
  | 'hintBizOrderId'
  | 'none'

export interface OfficialDisplayOrderNo {
  displayOrderNo: string
  officialOrderNo: string
  source: OrderDisplayNoSource
}

/** 纯数字且无 P 前缀：多为 JSON number 精度丢失，禁止作为展示订单号 */
export function isBareNumericOrderDisplay(value: string): boolean {
  const s = value.trim()
  if (!s || /^P/i.test(s)) return false
  return /^\d{12,}$/.test(s)
}

function scoreOrderNoCandidate(value: string): number {
  const s = value.trim()
  if (!s) return -1
  let score = s.length
  if (/^P\d{10,}$/i.test(s)) score += 10_000
  else if (/^P/i.test(s)) score += 5_000
  else if (/^\d+$/.test(s)) score -= 500
  return score
}

/** 仅接受字符串 / bigint，拒绝 JSON number（避免精度丢失） */
export function rawValueToOrderNoString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t || t === 'null' || t === 'undefined') return null
    return t
  }
  if (typeof value === 'bigint') return value.toString()
  return null
}

export function pickOrderIdentifierString(
  item: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const s = rawValueToOrderNoString(item[key])
    if (s) return s
  }
  return ''
}

function collectFromObject(
  obj: Record<string, unknown>,
  out: Array<{ value: string; source: OrderDisplayNoSource }>,
  sourcePrefix: OrderDisplayNoSource | 'nested',
): void {
  for (const { keys, source } of FLAT_ORDER_KEYS) {
    for (const key of keys) {
      const s = rawValueToOrderNoString(obj[key])
      if (s) {
        out.push({
          value: s,
          source: sourcePrefix === 'nested' ? 'nested' : (source as OrderDisplayNoSource),
        })
      }
    }
  }
}

export function pickOfficialDisplayOrderNo(
  raw: Record<string, unknown>,
  hints?: { packageId?: string; bizOrderId?: string; dbPackageId?: string; dbOrderId?: string },
): OfficialDisplayOrderNo {
  const candidates: Array<{ value: string; source: OrderDisplayNoSource }> = []

  collectFromObject(raw, candidates, 'orderSn')

  for (const nestKey of NESTED_OBJECTS) {
    const nested = raw[nestKey]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      collectFromObject(nested as Record<string, unknown>, candidates, 'nested')
    }
  }

  const hintPackage = hints?.packageId?.trim() || hints?.dbPackageId?.trim() || ''
  if (hintPackage && !isBareNumericOrderDisplay(hintPackage)) {
    candidates.push({ value: hintPackage, source: hints?.dbPackageId ? 'dbPackageId' : 'hintPackageId' })
  } else if (hintPackage && /^P/i.test(hintPackage)) {
    candidates.push({ value: hintPackage, source: hints?.dbPackageId ? 'dbPackageId' : 'hintPackageId' })
  }
  const hintBiz = hints?.bizOrderId?.trim() || hints?.dbOrderId?.trim() || ''
  if (hintBiz && !isBareNumericOrderDisplay(hintBiz)) {
    candidates.push({ value: hintBiz, source: hints?.dbOrderId ? 'dbOrderId' : 'hintBizOrderId' })
  } else if (hintBiz && /^P/i.test(hintBiz)) {
    candidates.push({ value: hintBiz, source: hints?.dbOrderId ? 'dbOrderId' : 'hintBizOrderId' })
  }

  const withP = candidates.filter((c) => /^P/i.test(c.value))
  const pool =
    withP.length > 0
      ? withP
      : candidates.filter((c) => !isBareNumericOrderDisplay(c.value))

  let best: { value: string; source: OrderDisplayNoSource } | null = null
  let bestScore = -1
  for (const c of pool) {
    const sc = scoreOrderNoCandidate(c.value)
    if (sc > bestScore) {
      bestScore = sc
      best = c
    }
  }

  if (best) {
    return {
      displayOrderNo: best.value,
      officialOrderNo: best.value,
      source: best.source,
    }
  }

  return { displayOrderNo: '', officialOrderNo: '', source: 'none' }
}

/** 全站展示订单号（Drawer / 导出 / 列表）；禁止回退到裸数字 bizOrderId */
export function resolveDisplayOrderNoForView(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
): string {
  const fromView = v.displayOrderNo?.trim() || v.officialOrderNo?.trim() || ''
  if (fromView && !isBareNumericOrderDisplay(fromView)) return fromView
  if (fromView && /^P/i.test(fromView)) return fromView

  if (v.raw) {
    const picked = pickOfficialDisplayOrderNo(v.raw, {
      packageId: v.packageId,
      bizOrderId: v.bizOrderId,
    })
    if (picked.displayOrderNo) return picked.displayOrderNo
  }

  if (v.packageId && /^P/i.test(v.packageId)) return v.packageId
  if (v.packageId && !isBareNumericOrderDisplay(v.packageId)) return v.packageId

  return '—'
}
