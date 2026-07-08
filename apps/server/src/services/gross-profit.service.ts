import type { SettlementPreprocessResult, SettlementRecord } from '../types/analysis'
import { parseMoneyToCent, pickBillFieldPair } from '../utils/amount-parse.service'
import { centToYuan } from '../utils/money'
import {
  type OrderSettlementKeyIndex,
  resolveSettlementRecordCanonicalOrderId,
} from './settlement-order-key-match.util'

const INCOME_CODES = new Set([
  'SELLER_INCOME',
  'TOTAL_IN_AMOUNT',
  'INCOME',
  'SETTLE_IN',
])

const REFUND_CODES = new Set([
  'REFUND',
  'REFUND_AMOUNT',
  'TOTAL_REFUND_AMOUNT',
  'RETURN_AMOUNT',
  'SETTLE_OUT_REFUND',
])

const FEE_CODES = new Set([
  'TOTAL_COMMISSION_AMOUNT',
  'TOTAL_SERVICE_FEE_AMOUNT',
  'SERVICE_FEE',
  'COMMISSION',
  'PLATFORM_FEE',
  'FREIGHT',
  'TOTAL_FREIGHT_AMOUNT',
  'SHIPPING_FEE',
])

function pickBillCode(raw: Record<string, unknown>): string {
  const map = raw.settleBill as Record<string, unknown> | undefined
  if (map && typeof map === 'object') {
    for (const k of Object.keys(map)) {
      if (map[k] != null) return k.toUpperCase()
    }
  }
  return String(raw.TRANS_TYPE ?? raw.transType ?? '').toUpperCase()
}

function pickSettleNo(r: SettlementRecord): string {
  const raw = r.raw as Record<string, unknown>
  return String(raw.settleNo ?? raw.SETTLE_NO ?? '').trim()
}

function pickTransType(r: SettlementRecord): string {
  const raw = r.raw as Record<string, unknown>
  return String(raw.TRANS_TYPE ?? raw.transType ?? r.statusText ?? '').toUpperCase()
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

function readBillCent(map: Record<string, unknown>, code: string): number {
  const pair = pickBillFieldPair(map, code)
  if (pair.value != null || pair.displayValue != null) {
    return parseMoneyToCent(pair.value, pair.displayValue, code).cent
  }
  return 0
}

function extractSettlementComponents(r: SettlementRecord): {
  incomeCent: number
  refundCent: number
  feeCent: number
  freightCent: number
} {
  const raw = r.raw as Record<string, unknown>
  const map = extractSettleBillMap(raw)

  const sellerIncome = readBillCent(map, 'SELLER_INCOME')
  const totalIn = readBillCent(map, 'TOTAL_IN_AMOUNT')
  const net = readBillCent(map, 'NET_AMOUNT') || readBillCent(map, 'SETTLE_AMOUNT')
  const refund =
    readBillCent(map, 'TOTAL_REFUND_AMOUNT') ||
    readBillCent(map, 'REFUND') ||
    readBillCent(map, 'REFUND_AMOUNT')
  const commission =
    readBillCent(map, 'TOTAL_COMMISSION_AMOUNT') || readBillCent(map, 'COMMISSION')
  const serviceFee =
    readBillCent(map, 'TOTAL_SERVICE_FEE_AMOUNT') || readBillCent(map, 'SERVICE_FEE')
  const freight =
    readBillCent(map, 'TOTAL_FREIGHT_AMOUNT') ||
    readBillCent(map, 'FREIGHT') ||
    readBillCent(map, 'SHIPPING_FEE')
  const platformFee = readBillCent(map, 'PLATFORM_FEE')

  const incomeFromFields = sellerIncome || totalIn
  const feeFromFields = commission + serviceFee + platformFee
  const refundFromFields = refund

  if (net !== 0 && incomeFromFields === 0 && refundFromFields === 0 && feeFromFields === 0 && freight === 0) {
    return {
      incomeCent: Math.max(0, net),
      refundCent: 0,
      feeCent: 0,
      freightCent: 0,
    }
  }

  let incomeCent = incomeFromFields
  if (incomeCent === 0 && net > 0) incomeCent = net

  if (incomeCent === 0 && r.direction === 'income') {
    incomeCent = Math.max(0, r.amountCent)
  }

  let refundCent = refundFromFields
  if (refundCent === 0 && r.direction === 'refund') {
    refundCent = Math.abs(r.amountCent)
  }

  let feeCent = feeFromFields
  let freightCent = freight
  if (r.direction === 'fee' && feeCent + freightCent === 0) {
    const abs = Math.abs(r.amountCent)
    if (pickTransType(r).includes('FREIGHT')) freightCent = abs
    else feeCent = abs
  }

  return {
    incomeCent: Math.max(0, incomeCent),
    refundCent: Math.abs(refundCent),
    feeCent: Math.abs(feeCent),
    freightCent: Math.abs(freightCent),
  }
}

function classifyRecord(r: SettlementRecord): 'income' | 'refund' | 'fee' | 'unknown' {
  if (r.direction === 'income') return 'income'
  if (r.direction === 'refund') return 'refund'
  if (r.direction === 'fee') return 'fee'
  const code = pickBillCode(r.raw as Record<string, unknown>)
  if (INCOME_CODES.has(code) || code.includes('INCOME') || code.includes('IN_AMOUNT')) return 'income'
  if (REFUND_CODES.has(code) || code.includes('REFUND') || code.includes('RETURN')) return 'refund'
  if (FEE_CODES.has(code) || code.includes('FEE') || code.includes('COMMISSION') || code.includes('FREIGHT'))
    return 'fee'
  return 'unknown'
}

function uniqueKey(r: SettlementRecord): string {
  const settleNo = pickSettleNo(r)
  const pkg = r.orderId
  const trans = pickTransType(r)
  return `${settleNo}|${pkg}|${trans}|${r.settlementType}`
}

export interface GrossProfitBreakdown {
  gmvCent: number
  settledIncomeCent: number
  pendingIncomeCent: number
  refundCent: number
  feeCent: number
  freightCent: number
  grossProfitCent: number
  matchedSettlementCount: number
  unmatchedSettlementCount: number
  nonCurrentSettlementCount: number
  duplicateSettlementCount: number
  unknownFieldCount: number
  warnings: string[]
  note: string
  samples: Array<{
    packageId: string
    settleNo: string
    transType: string
    amountCent: number
    direction: string
    matchedOrder: boolean
    includedInGrossProfit: boolean
    reason: string
  }>
}

export function computeGrossProfitBreakdown(
  orderKeyIndex: OrderSettlementKeyIndex,
  gmvCent: number,
  settlement: SettlementPreprocessResult | undefined,
): GrossProfitBreakdown {
  const warnings: string[] = []
  const samples: GrossProfitBreakdown['samples'] = []
  let settledIncomeCent = 0
  let pendingIncomeCent = 0
  let refundCent = 0
  let feeCent = 0
  let freightCent = 0
  let unmatchedSettlementCount = 0
  let nonCurrentSettlementCount = 0
  let duplicateSettlementCount = 0
  let unknownFieldCount = 0
  let matchedSettlementCount = 0

  const settledByCanonical = new Map<string, SettlementRecord>()
  for (const r of settlement?.settledRecords ?? []) {
    const canonical = resolveSettlementRecordCanonicalOrderId(r, orderKeyIndex)
    if (canonical) settledByCanonical.set(canonical, r)
  }

  const seen = new Set<string>()
  const allRecords = [
    ...(settlement?.settledRecords ?? []).map((r) => ({ ...r, bill: 'settled' as const })),
    ...(settlement?.pendingRecords ?? []).map((r) => ({ ...r, bill: 'pending' as const })),
  ]

  for (const row of allRecords) {
    const r = row as SettlementRecord & { bill: 'settled' | 'pending' }
    const key = uniqueKey(r)
    if (seen.has(key)) {
      duplicateSettlementCount += 1
      continue
    }
    seen.add(key)

    const canonical = resolveSettlementRecordCanonicalOrderId(r, orderKeyIndex)
    const matchedOrder =
      canonical != null && orderKeyIndex.canonicalOrderIds.has(canonical)

    if (!matchedOrder) {
      if (r.orderId || canonical) nonCurrentSettlementCount += 1
      else unmatchedSettlementCount += 1
      if (samples.length < 20) {
        samples.push({
          packageId: (canonical ?? r.orderId) || '—',
          settleNo: pickSettleNo(r),
          transType: pickTransType(r),
          amountCent: r.amountCent,
          direction: r.direction,
          matchedOrder: false,
          includedInGrossProfit: false,
          reason: '不在当前范围订单',
        })
      }
      continue
    }

    if (r.bill === 'pending' && settledByCanonical.has(canonical)) {
      duplicateSettlementCount += 1
      if (samples.length < 20) {
        samples.push({
          packageId: canonical ?? r.orderId,
          settleNo: pickSettleNo(r),
          transType: pickTransType(r),
          amountCent: r.amountCent,
          direction: 'pending_skip',
          matchedOrder: true,
          includedInGrossProfit: false,
          reason: '已有已结算记录，跳过待结算重复',
        })
      }
      continue
    }

    matchedSettlementCount += 1
    const comp = extractSettlementComponents(r)
    const kind = classifyRecord(r)
    let included = true

    if (comp.incomeCent > 0 || comp.refundCent > 0 || comp.feeCent > 0 || comp.freightCent > 0) {
      if (r.bill === 'settled') settledIncomeCent += comp.incomeCent
      else pendingIncomeCent += comp.incomeCent
      refundCent += comp.refundCent
      feeCent += comp.feeCent
      freightCent += comp.freightCent
    } else if (kind === 'income') {
      if (r.bill === 'settled') settledIncomeCent += Math.max(0, r.amountCent)
      else pendingIncomeCent += Math.max(0, r.amountCent)
    } else if (kind === 'refund') {
      refundCent += Math.abs(r.amountCent)
    } else if (kind === 'fee') {
      const abs = Math.abs(r.amountCent)
      feeCent += abs
      if (pickTransType(r).includes('FREIGHT')) freightCent += abs
    } else {
      unknownFieldCount += 1
      included = false
      warnings.push(`未识别结算字段：${pickTransType(r)}`)
    }

    if (samples.length < 20) {
      samples.push({
        packageId: canonical ?? r.orderId,
        settleNo: pickSettleNo(r),
        transType: pickTransType(r),
        amountCent: r.amountCent,
        direction: kind,
        matchedOrder: true,
        includedInGrossProfit: included,
        reason: included ? '计入毛利润' : '未识别字段',
      })
    }
  }

  const grossProfitCent =
    settledIncomeCent + pendingIncomeCent - refundCent - feeCent - freightCent

  if (unknownFieldCount > 0) {
    warnings.push('存在未识别结算字段，毛利润可能不完整')
  }
  if (grossProfitCent > gmvCent * 2 && gmvCent > 0) {
    warnings.push('毛利润高于 GMV 的 2 倍，可能存在结算重复、单位异常或跨范围结算')
  }

  const note =
    '毛利润（不算商品成本）= 已结算正向收入 + 待结算正向收入 - 退款扣回 - 平台扣费/服务费/佣金 - 运费；待结算与已结算同一订单仅计已结算。'

  return {
    gmvCent,
    settledIncomeCent,
    pendingIncomeCent,
    refundCent,
    feeCent,
    freightCent,
    grossProfitCent,
    matchedSettlementCount,
    unmatchedSettlementCount,
    nonCurrentSettlementCount,
    duplicateSettlementCount,
    unknownFieldCount,
    warnings,
    note,
    samples,
  }
}

export function grossProfitToDisplay(b: GrossProfitBreakdown) {
  return {
    gmv: centToYuan(b.gmvCent),
    settledIncome: centToYuan(b.settledIncomeCent),
    pendingIncome: centToYuan(b.pendingIncomeCent),
    refund: centToYuan(b.refundCent),
    fee: centToYuan(b.feeCent),
    freight: centToYuan(b.freightCent),
    grossProfit: centToYuan(b.grossProfitCent),
    formula:
      '毛利润 = 已结算正向收入 + 待结算正向收入 - 退款扣回 - 平台扣费/服务费/佣金 - 运费（未扣商品采购成本）',
    warnings: b.warnings,
    breakdown: b,
  }
}
