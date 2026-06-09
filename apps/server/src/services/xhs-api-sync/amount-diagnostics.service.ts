import { prisma } from '../../lib/prisma'
import {
  extractFieldPair,
  parseMoneyToCent,
  pickBillFieldPair,
} from '../../utils/amount-parse.service'

function jsonRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
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

export async function buildAmountUnitDiagnostics() {
  const warnings: string[] = []
  let suspected100xInflated = false
  const suspected100xDeflated = false

  const orderSamples = await prisma.xhsRawOrder.findMany({
    take: 5,
    orderBy: { updatedAt: 'desc' },
  })

  const orderRows = orderSamples
    .map((row) => {
      const item = jsonRecord(row.rawJson)
      const keys = ['actualSellerReceiveAmount', 'actualPaid', 'totalOrderAmount']
      for (const key of keys) {
        const pair = extractFieldPair(item, key)
        const flat = item[key]
        const raw = pair.value ?? flat
        const display = pair.displayValue
        if (raw == null && display == null) continue
        const parsed = parseMoneyToCent(raw, display, key)
        if (parsed.strategy.includes('100x')) {
          suspected100xInflated = true
          warnings.push(...parsed.warnings)
        }
        return {
          field: key,
          rawValue: raw,
          displayValue: display ?? null,
          parsedCent: parsed.cent,
          parsedYuan: parsed.parsedYuan,
          strategy: parsed.strategy,
          warnings: parsed.warnings,
        }
      }
      return null
    })
    .filter(Boolean)

  const liveSamples = await prisma.xhsRawLiveSession.findMany({
    take: 3,
    orderBy: { updatedAt: 'desc' },
  })

  const liveRows = liveSamples
    .map((row) => {
      const item = jsonRecord(row.rawJson)
      for (const key of ['sellerRealIncomeAmt', 'refundAmt']) {
        const pair = extractFieldPair(item, key)
        if (pair.value == null && pair.displayValue == null) continue
        const parsed = parseMoneyToCent(pair.value, pair.displayValue, key)
        if (parsed.strategy.includes('100x')) suspected100xInflated = true
        return {
          field: key,
          rawValue: pair.value,
          displayValue: pair.displayValue ?? null,
          parsedCent: parsed.cent,
          parsedYuan: parsed.parsedYuan,
          strategy: parsed.strategy,
          warnings: parsed.warnings,
        }
      }
      return null
    })
    .filter(Boolean)

  const settlementSamples = await prisma.xhsRawSettledSettlement.findMany({
    take: 3,
    orderBy: { updatedAt: 'desc' },
  })

  const settlementRows = settlementSamples
    .map((row) => {
      const item = jsonRecord(row.rawJson)
      const map = extractSettleBillMap(item)
      for (const code of ['SELLER_INCOME', 'TOTAL_IN_AMOUNT']) {
        const pair = pickBillFieldPair(map, code)
        if (pair.value == null && pair.displayValue == null) continue
        const parsed = parseMoneyToCent(pair.value, pair.displayValue, code)
        if (parsed.strategy.includes('100x')) suspected100xInflated = true
        return {
          field: code,
          rawValue: pair.value,
          displayValue: pair.displayValue ?? null,
          parsedCent: parsed.cent,
          parsedYuan: parsed.parsedYuan,
          strategy: parsed.strategy,
          warnings: parsed.warnings,
        }
      }
      return null
    })
    .filter(Boolean)

  return {
    orderSamples: orderRows,
    liveSamples: liveRows,
    settlementSamples: settlementRows,
    suspected100xInflated,
    suspected100xDeflated,
    warnings: [...new Set(warnings)],
    strategySummary:
      '优先 displayValue 按元解析；无 displayValue 时大整数按分、带小数按元；100 倍冲突时采用 displayValue',
  }
}
