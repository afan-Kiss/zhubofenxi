import { prisma } from '../lib/prisma'
import { centToYuan } from '../utils/money'
import { parseMoneyToCent, pickBillFieldPair } from '../utils/amount-parse.service'
import { normalizeSettlementItem } from './xhs-api-sync/xhs-json-normalizer.service'

/** 经营看板账单汇总公式版本 */
export const BILLING_FORMULA_VERSION = 'v4-net-settlement-2026-05'

export const BILLING_NET_INCOME_NOTE =
  '本月预计净入账按平台已结算与待结算动账金额汇总，未扣商品成本、包装、证书、人工等成本。'

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
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

function readBillCent(map: Record<string, unknown>, code: string): number {
  const pair = pickBillFieldPair(map, code)
  if (pair.value != null || pair.displayValue != null) {
    return parseMoneyToCent(pair.value, pair.displayValue, code).cent
  }
  return 0
}

/** 动账金额 / 预计动账金额：优先 NET_AMOUNT，直接求和，不重复扣佣金/运费/退款 */
export function readSettlementNetCent(rawJson: unknown): number {
  const item = asRecord(rawJson)
  const map = extractSettleBillMap(item)
  const net = readBillCent(map, 'NET_AMOUNT') || readBillCent(map, 'SETTLE_AMOUNT')
  if (net !== 0) return net
  const sellerIncome = readBillCent(map, 'SELLER_INCOME')
  if (sellerIncome !== 0) return sellerIncome
  const normalized = normalizeSettlementItem(item, 'settled', 0)
  return normalized.amountCent
}

function dateInRange(d: Date | null | undefined, startDate: string, endDate: string): boolean {
  if (!d) return true
  const day = d.toISOString().slice(0, 10)
  return day >= startDate && day <= endDate
}

export interface BoardBillingSummary {
  billingFormulaVersion: string
  billingNote: string
  settledNetIncome: number
  pendingNetIncome: number
  estimatedNetIncome: number
  settledIncomeTotal: number
  settledRefundTotal: number
  pendingIncomeTotal: number
  pendingRefundTotal: number
  settledRecordCount: number
  pendingRecordCount: number
  lastBillingUpdatedAt: string | null
}

export async function computeBoardBillingSummary(
  startDate: string,
  endDate: string,
): Promise<BoardBillingSummary> {
  const [settledRows, pendingRows] = await Promise.all([
    prisma.xhsRawSettledSettlement.findMany({ orderBy: { updatedAt: 'desc' } }),
    prisma.xhsRawPendingSettlement.findMany({ orderBy: { updatedAt: 'desc' } }),
  ])

  let settledNetCent = 0
  let settledIncomeCent = 0
  let settledRefundCent = 0
  let settledCount = 0
  let lastUpdated: Date | null = null

  for (const row of settledRows) {
    const refDate = row.settleTime ?? row.orderTime
    if (!dateInRange(refDate, startDate, endDate)) continue
    const net = readSettlementNetCent(row.rawJson)
    settledNetCent += net
    if (net > 0) settledIncomeCent += net
    else if (net < 0) settledRefundCent += net
    settledCount += 1
    if (row.updatedAt && (!lastUpdated || row.updatedAt > lastUpdated)) {
      lastUpdated = row.updatedAt
    }
  }

  let pendingNetCent = 0
  let pendingIncomeCent = 0
  let pendingRefundCent = 0
  let pendingCount = 0

  for (const row of pendingRows) {
    if (!dateInRange(row.orderTime, startDate, endDate)) continue
    const net = readSettlementNetCent(row.rawJson)
    pendingNetCent += net
    if (net > 0) pendingIncomeCent += net
    else if (net < 0) pendingRefundCent += net
    pendingCount += 1
    if (row.updatedAt && (!lastUpdated || row.updatedAt > lastUpdated)) {
      lastUpdated = row.updatedAt
    }
  }

  const settledNetIncome = centToYuan(settledNetCent)
  const pendingNetIncome = centToYuan(pendingNetCent)

  return {
    billingFormulaVersion: BILLING_FORMULA_VERSION,
    billingNote: BILLING_NET_INCOME_NOTE,
    settledNetIncome,
    pendingNetIncome,
    estimatedNetIncome: centToYuan(settledNetCent + pendingNetCent),
    settledIncomeTotal: centToYuan(settledIncomeCent),
    settledRefundTotal: centToYuan(settledRefundCent),
    pendingIncomeTotal: centToYuan(pendingIncomeCent),
    pendingRefundTotal: centToYuan(pendingRefundCent),
    settledRecordCount: settledCount,
    pendingRecordCount: pendingCount,
    lastBillingUpdatedAt: lastUpdated ? lastUpdated.toISOString() : null,
  }
}
