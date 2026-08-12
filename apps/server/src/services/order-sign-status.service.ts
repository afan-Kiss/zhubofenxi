import type { AnalyzedOrderView } from '../types/analysis'
import type { NormalizedOrder } from '../types/analysis'

/**
 * 已签收金额 / 已签收单数 / 签收率：仅「交易完成」类状态。
 * 平台「已签收」「已收货」不算入此池，归入「正在路上/待签收完成」。
 */
const STATUS_COMPLETED_KEYWORDS = ['已完成', '交易成功', '交易完成'] as const

/** 快递侧已签收/已收货，但尚未交易完成 */
const STATUS_COURIER_SIGNED_KEYWORDS = ['已签收', '已收货'] as const

/** 明确不算完成、也不算待签收完成的状态 */
const NOT_SIGNED_KEYWORDS = [
  '已取消',
  '已关闭',
  '交易关闭',
  '待配货',
  '待发货',
  '已发货',
  '运输中',
  '派送中',
  '待收货',
  '未签收',
  '待支付',
  '未支付',
] as const

function containsAny(text: string, keywords: readonly string[]): boolean {
  if (!text) return false
  return keywords.some((k) => text.includes(k))
}

function orderStatusTexts(...parts: Array<string | undefined | null>): string {
  return parts.filter(Boolean).join(' ')
}

function rawOrderStatusText(order: NormalizedOrder): string {
  const raw = order.raw as Record<string, unknown> | undefined
  if (raw == null) return ''
  return String(
    raw.statusDesc ?? raw.status_desc ?? raw.statusName ?? raw.tradeStatus ?? '',
  )
}

/** 交易完成（计入已签收金额） */
export function isStatusCompletedFromTexts(...parts: Array<string | undefined | null>): boolean {
  const text = orderStatusTexts(...parts)
  if (!text) return false
  if (containsAny(text, NOT_SIGNED_KEYWORDS)) return false
  return containsAny(text, STATUS_COMPLETED_KEYWORDS)
}

/**
 * 快递已签收、尚未交易完成（计入「正在路上/待签收完成」）。
 * 若同时含「已完成/交易完成」则不算本池。
 */
export function isStatusCourierSignedOnlyFromTexts(
  ...parts: Array<string | undefined | null>
): boolean {
  const text = orderStatusTexts(...parts)
  if (!text) return false
  if (containsAny(text, NOT_SIGNED_KEYWORDS)) return false
  if (containsAny(text, STATUS_COMPLETED_KEYWORDS)) return false
  return containsAny(text, STATUS_COURIER_SIGNED_KEYWORDS)
}

/**
 * @deprecated 名称保留：现仅表示「交易完成」类，供已签收金额使用。
 * 需要快递已签收请用 isStatusCourierSignedOnlyFromTexts。
 */
export function isStatusSignedFromTexts(...parts: Array<string | undefined | null>): boolean {
  return isStatusCompletedFromTexts(...parts)
}

export function isStatusCompletedOrder(order: NormalizedOrder): boolean {
  return isStatusCompletedFromTexts(order.orderStatusText, rawOrderStatusText(order))
}

export function isStatusCourierSignedOnlyOrder(order: NormalizedOrder): boolean {
  return isStatusCourierSignedOnlyFromTexts(order.orderStatusText, rawOrderStatusText(order))
}

/** @deprecated 同 isStatusCompletedOrder */
export function isStatusSignedOrder(order: NormalizedOrder): boolean {
  return isStatusCompletedOrder(order)
}

function viewOrderStatusParts(v: AnalyzedOrderView): Array<string | undefined | null> {
  const raw = (v as AnalyzedOrderView & { raw?: Record<string, unknown> }).raw
  const rawText =
    raw && typeof raw === 'object'
      ? String(
          raw.statusDesc ?? raw.status_desc ?? raw.statusName ?? raw.tradeStatus ?? '',
        )
      : ''
  return [v.orderStatusText, rawText]
}

export function isStatusCompletedView(v: AnalyzedOrderView): boolean {
  return isStatusCompletedFromTexts(...viewOrderStatusParts(v))
}

export function isStatusCourierSignedOnlyView(v: AnalyzedOrderView): boolean {
  return isStatusCourierSignedOnlyFromTexts(...viewOrderStatusParts(v))
}

/** @deprecated 同 isStatusCompletedView */
export function isStatusSignedView(v: AnalyzedOrderView): boolean {
  return isStatusCompletedView(v)
}

const SHIPPED_OUT_KEYWORDS = ['已发货', '待收货', '运输中', '派送中', '待签收'] as const

/** 已发出（在途物流），不含待配货/待发货、已关闭、快递已签收、交易完成 */
export function isShippedOutOrderView(v: AnalyzedOrderView): boolean {
  if (!v.includedInGmv) return false
  const text = (v.orderStatusText ?? '').trim()
  if (!text) return false
  if (text.includes('已发货未签收')) return true
  if (/已取消|已关闭|交易关闭|待配货|待发货|未支付/.test(text)) return false
  if (text.includes('未签收') && !text.includes('已发货')) return false
  if (isStatusCompletedFromTexts(text) || isStatusCourierSignedOnlyFromTexts(text)) return false
  return containsAny(text, SHIPPED_OUT_KEYWORDS)
}
