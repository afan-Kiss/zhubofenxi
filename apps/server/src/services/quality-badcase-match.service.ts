import { prisma } from '../lib/prisma'
import type { NormalizedOrder } from '../types/analysis'
import type { NormalizedQualityBadCase, QualityBadCaseMatchStatus } from './quality-badcase.types'
import { yuanApiAmountToCent } from './xhs-after-sales-workbench.service'
import { isSuccessfulAfterSale } from './strict-after-sale-metrics.service'
import {
  LEGACY_LIVE_ACCOUNT_ID,
  liveAccountOrderKey,
  resolveLiveAccountId,
} from '../utils/live-account-cache-key.util'

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function orderNoCandidates(order: NormalizedOrder): string[] {
  const out = new Set<string>()
  for (const v of [
    order.displayOrderNo,
    order.officialOrderNo,
    order.packageId,
    order.matchOrderId,
    order.orderId,
  ]) {
    const s = String(v ?? '').trim()
    if (s) out.add(s)
  }
  const raw = order.raw as Record<string, unknown> | undefined
  if (raw) {
    for (const k of ['packageId', 'package_id', 'delivery_package_id', 'orderNo', 'order_no']) {
      const s = pickString(raw, [k])
      if (s) out.add(s)
    }
  }
  return [...out]
}

function sameLiveAccount(order: NormalizedOrder, liveAccountId: string): boolean {
  const caseAccount = resolveLiveAccountId(liveAccountId)
  if (caseAccount === LEGACY_LIVE_ACCOUNT_ID) return true
  return resolveLiveAccountId(order.liveAccountId) === caseAccount
}

function findOrderByPackageId(
  packageId: string,
  liveAccountId: string,
  orders: NormalizedOrder[],
): NormalizedOrder | null {
  const target = packageId.trim()
  if (!target) return null
  for (const o of orders) {
    if (!sameLiveAccount(o, liveAccountId)) continue
    if (orderNoCandidates(o).some((no) => no === target)) return o
  }
  return null
}

function findAfterSaleBySourceBizId(
  sourceBizId: string,
  liveAccountId: string,
  rawAfterSalesByOrderNo: Map<string, Record<string, unknown>[]>,
): { orderNo: string; record: Record<string, unknown> } | null {
  const target = sourceBizId.trim()
  if (!target) return null
  const prefix = `${resolveLiveAccountId(liveAccountId)}::`
  for (const [key, records] of rawAfterSalesByOrderNo) {
    if (!key.startsWith(prefix)) continue
    for (const rec of records) {
      const rid = pickString(rec, ['returns_id', 'returnsId', 'return_id', 'sourceBizId'])
      if (rid === target) {
        return { orderNo: key.slice(prefix.length), record: rec }
      }
    }
  }
  return null
}

export function matchQualityBadCases(params: {
  cases: NormalizedQualityBadCase[]
  orders: NormalizedOrder[]
  attributions: Map<number, { anchorId: string; anchorName: string }>
  rawAfterSalesByOrderNo?: Map<string, Record<string, unknown>[]>
}): NormalizedQualityBadCase[] {
  const { orders, attributions, rawAfterSalesByOrderNo } = params
  const orderIndex = new Map<string, NormalizedOrder>()
  for (const o of orders) {
    const accountId = resolveLiveAccountId(o.liveAccountId)
    for (const no of orderNoCandidates(o)) {
      const key = liveAccountOrderKey(accountId, no)
      if (!orderIndex.has(key)) orderIndex.set(key, o)
    }
  }

  return params.cases.map((c) => {
    const liveAccountId = resolveLiveAccountId(c.liveAccountId)
    let matchedOrder = findOrderByPackageId(c.packageId, liveAccountId, orders)
    let matchedAfterSale: { orderNo: string; record: Record<string, unknown> } | null = null
    if (c.sourceBizId && rawAfterSalesByOrderNo) {
      matchedAfterSale = findAfterSaleBySourceBizId(
        c.sourceBizId,
        liveAccountId,
        rawAfterSalesByOrderNo,
      )
      if (!matchedOrder && matchedAfterSale) {
        matchedOrder =
          orderIndex.get(liveAccountOrderKey(liveAccountId, matchedAfterSale.orderNo)) ?? null
      }
    }

    let matchStatus: QualityBadCaseMatchStatus = 'unmatched'
    if (matchedOrder && matchedAfterSale) matchStatus = 'matched_order_and_after_sale'
    else if (matchedOrder) matchStatus = 'matched_order_only'
    else if (matchedAfterSale) matchStatus = 'matched_after_sale_only'

    const attr = matchedOrder
      ? attributions.get(matchedOrder.sourceRowIndex)
      : undefined
    const afterRec = matchedAfterSale?.record
    const afterSaleStatus = afterRec
      ? pickString(afterRec, [
          'refund_status_name',
          'refundStatusName',
          'status_name',
          'statusName',
        ])
      : ''
    const afterSaleReason = afterRec
      ? pickString(afterRec, ['reason_name_zh', 'reasonNameZh', 'reason'])
      : ''
    const refundCent = afterRec ? yuanApiAmountToCent(afterRec.refund_fee ?? afterRec.refundFee) : 0

    return {
      ...c,
      liveAccountId: matchedOrder
        ? resolveLiveAccountId(matchedOrder.liveAccountId)
        : liveAccountId,
      matchedOrderNo: matchedOrder
        ? matchedOrder.displayOrderNo || matchedOrder.officialOrderNo || c.packageId
        : c.packageId,
      matchedOrderId: matchedOrder?.matchOrderId ?? '',
      matchedAfterSaleId: c.sourceBizId ?? (matchedAfterSale ? pickString(matchedAfterSale.record, ['returns_id', 'returnsId']) : ''),
      matchedBuyerId: matchedOrder?.buyerId ?? '',
      matchedBuyerNickname: String(
        (matchedOrder?.raw as Record<string, unknown> | undefined)?._buyerNickname ?? '',
      ).trim(),
      matchedAnchorId: attr?.anchorId ?? '',
      matchedAnchorName: attr?.anchorName ?? '',
      afterSaleStatus,
      afterSaleReason,
      afterSaleRefundAmount: refundCent / 100,
      afterSaleRefunded: afterRec ? isSuccessfulAfterSale(afterRec) : false,
      matchStatus,
    }
  })
}

export async function loadOrdersForQualityMatch(): Promise<NormalizedOrder[]> {
  const rows = await prisma.xhsRawOrder.findMany({
    select: { packageId: true, liveAccountId: true, liveAccountName: true, rawJson: true },
    take: 50000,
  })
  const orders: NormalizedOrder[] = []
  for (const row of rows) {
    try {
      const rawJson = row.rawJson
      const raw =
        typeof rawJson === 'string'
          ? (JSON.parse(rawJson) as Record<string, unknown>)
          : ((rawJson as Record<string, unknown>) ?? {})
      const packageId = String(row.packageId ?? raw.packageId ?? '').trim()
      const displayNo = String(
        raw.displayOrderNo ?? raw.officialOrderNo ?? raw.packageId ?? packageId,
      ).trim()
      orders.push({
        sourceRowIndex: orders.length,
        orderId: packageId,
        packageId,
        bizOrderId: String(raw.bizOrderId ?? raw.biz_order_id ?? '').trim(),
        officialOrderNo: displayNo,
        displayOrderNo: displayNo,
        matchOrderId: packageId || displayNo,
        buyerId: String(raw.buyerId ?? raw.buyer_id ?? '').trim(),
        liveAccountId: row.liveAccountId ?? undefined,
        liveAccountName: row.liveAccountName ?? undefined,
        errors: [],
        raw,
      } as unknown as NormalizedOrder)
    } catch {
      // skip bad row
    }
  }
  return orders
}

/** 按 P 单号加载订单（品退 HAR 种子 / 轻量匹配，避免全量 bundle OOM） */
export async function loadOrdersForQualityMatchByPackageIds(
  packageIds: string[],
): Promise<NormalizedOrder[]> {
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []

  const rows = await prisma.xhsRawOrder.findMany({
    where: { packageId: { in: ids } },
    select: { packageId: true, liveAccountId: true, liveAccountName: true, rawJson: true },
  })
  const orders: NormalizedOrder[] = []
  for (const row of rows) {
    try {
      const rawJson = row.rawJson
      const raw =
        typeof rawJson === 'string'
          ? (JSON.parse(rawJson) as Record<string, unknown>)
          : ((rawJson as Record<string, unknown>) ?? {})
      const packageId = String(row.packageId ?? raw.packageId ?? '').trim()
      const displayNo = String(
        raw.displayOrderNo ?? raw.officialOrderNo ?? raw.packageId ?? packageId,
      ).trim()
      orders.push({
        sourceRowIndex: orders.length,
        orderId: packageId,
        packageId,
        bizOrderId: String(raw.bizOrderId ?? raw.biz_order_id ?? '').trim(),
        officialOrderNo: displayNo,
        displayOrderNo: displayNo,
        matchOrderId: packageId || displayNo,
        buyerId: String(raw.buyerId ?? raw.buyer_id ?? '').trim(),
        liveAccountId: row.liveAccountId ?? undefined,
        liveAccountName: row.liveAccountName ?? undefined,
        errors: [],
        raw,
      } as unknown as NormalizedOrder)
    } catch {
      // skip bad row
    }
  }
  return orders
}
