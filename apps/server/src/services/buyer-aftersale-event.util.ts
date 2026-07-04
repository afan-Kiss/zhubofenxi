/**
 * 买家排行：售后事件时间、售后单号提取（高风险榜 / 高价值榜共用）
 */
import type { AnalyzedOrderView } from '../types/analysis'
import type { BuyerRankingDateRange } from '../utils/buyer-ranking-date-range'
import { parseDateTime } from '../utils/time'
import type { BuyerOrderStandardRow } from './buyer-order-standard.service'

function parseTimeTextMs(text: string | null | undefined): number | null {
  if (!text || text === '—') return null
  const parsed = parseDateTime(text)
  if (!parsed.ok || !parsed.date) return null
  const ms = parsed.date.getTime()
  return Number.isFinite(ms) ? ms : null
}

export function timeTextInBuyerRankingRange(
  text: string | null | undefined,
  range: Pick<BuyerRankingDateRange, 'startTimeMs' | 'endTimeMs'>,
): boolean {
  const ms = parseTimeTextMs(text)
  if (ms == null) return false
  return ms >= range.startTimeMs && ms <= range.endTimeMs
}

/** 订单支付时间是否落在买家排行范围内 */
export function viewPayTimeInBuyerRankingRange(
  v: AnalyzedOrderView,
  range: Pick<BuyerRankingDateRange, 'startTimeMs' | 'endTimeMs'>,
): boolean {
  return timeTextInBuyerRankingRange(v.orderTimeText, range)
}

function collectAfterSaleTimeCandidates(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  row: BuyerOrderStandardRow,
): Array<string | null | undefined> {
  const raw = v.raw
  return [
    row.afterSaleApplyTime,
    row.afterSaleCompleteTime,
    raw?.afterSaleApplyTime as string | undefined,
    raw?.after_sale_apply_time as string | undefined,
    raw?.applyTime as string | undefined,
    raw?.returnsCreateTime as string | undefined,
    raw?.afterSaleCompleteTime as string | undefined,
    raw?.after_sale_complete_time as string | undefined,
    raw?.refundTime as string | undefined,
    raw?.refund_time as string | undefined,
    raw?.refundOkTime as string | undefined,
    raw?.refund_ok_time as string | undefined,
  ]
}

/** 本期是否发生售后/退款（申请、完成、退款时间任一命中范围） */
export function viewAfterSaleEventInBuyerRankingRange(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  range: Pick<BuyerRankingDateRange, 'startTimeMs' | 'endTimeMs'>,
  row: BuyerOrderStandardRow,
): boolean {
  for (const t of collectAfterSaleTimeCandidates(v, row)) {
    if (timeTextInBuyerRankingRange(t, range)) return true
  }
  if (row.hasEffectiveAfterSale && viewPayTimeInBuyerRankingRange(v, range)) {
    return true
  }
  return false
}

function pushId(set: Set<string>, value: unknown): void {
  if (value == null) return
  const s = String(value).trim()
  if (s && s !== '—') set.add(s)
}

function idsFromDelimited(value: unknown): string[] {
  if (value == null) return []
  return String(value)
    .split(/[、,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 从 raw / 售后缓存 / 标准行提取售后单号（去重） */
export function extractAfterSaleNosFromSources(params: {
  raw?: Record<string, unknown>
  rawAfterSaleRecords?: Record<string, unknown>[]
  returnsIds?: string[]
  rowAfterSaleNo?: string | null
}): string[] {
  const ids = new Set<string>()
  for (const id of params.returnsIds ?? []) pushId(ids, id)
  for (const part of idsFromDelimited(params.rowAfterSaleNo)) ids.add(part)

  const raw = params.raw
  if (raw) {
    for (const part of idsFromDelimited(raw.afterSaleNo ?? raw.after_sale_no)) ids.add(part)
    pushId(ids, raw.returns_id ?? raw.return_id ?? raw.returnId ?? raw.after_sale_id)
    const listKeys = ['returnsIds', 'returns_ids', 'returnIds', 'afterSaleIds', 'after_sale_ids']
    for (const key of listKeys) {
      const arr = raw[key]
      if (Array.isArray(arr)) {
        for (const item of arr) pushId(ids, item)
      }
    }
  }

  for (const rec of params.rawAfterSaleRecords ?? []) {
    if (!rec || typeof rec !== 'object') continue
    pushId(ids, rec.returns_id ?? rec.return_id ?? rec.id ?? rec.after_sale_id ?? rec.afterSaleId)
    pushId(ids, rec.returnsId ?? rec.returnId)
  }

  return [...ids]
}

/** 售后申请次数（事件级；纯运费补偿不计） */
export function countAftersaleAppliesForViewRow(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  row: BuyerOrderStandardRow,
  options?: {
    rawAfterSaleRecords?: Record<string, unknown>[]
    returnsIds?: string[]
  },
): number {
  if (v.isFreightRefundOnly) return 0
  const nos = extractAfterSaleNosFromSources({
    raw: v.raw,
    rawAfterSaleRecords: options?.rawAfterSaleRecords,
    returnsIds: options?.returnsIds,
    rowAfterSaleNo: row.afterSaleNo,
  })
  if (nos.length > 0) return nos.length
  if (
    row.hasEffectiveAfterSale ||
    row.refundAmountPending ||
    row.refundAmountCent > 0 ||
    v.isReturnRefund ||
    v.isRefundOnly ||
    v.afterSaleClosedNoRefund ||
    v.isQualityReturn
  ) {
    return 1
  }
  return 0
}
