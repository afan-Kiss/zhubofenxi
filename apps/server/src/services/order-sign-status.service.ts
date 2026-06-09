import type { AnalyzedOrderView } from '../types/analysis'
import type { NormalizedOrder } from '../types/analysis'

/** 订单正向签收/完成状态（仅看订单状态，不看售后状态） */
const STATUS_SIGNED_KEYWORDS = [
  '已签收',
  '已完成',
  '交易成功',
  '交易完成',
  '已收货',
] as const

/** 明确不算签收的状态 */
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

/** 签收状态：仅订单状态为已签收/交易成功等，排除已发货未签收、已取消等 */
export function isStatusSignedFromTexts(...parts: Array<string | undefined | null>): boolean {
  const text = orderStatusTexts(...parts)
  if (!text) return false
  if (containsAny(text, NOT_SIGNED_KEYWORDS)) return false
  return containsAny(text, STATUS_SIGNED_KEYWORDS)
}

export function isStatusSignedOrder(order: NormalizedOrder): boolean {
  const raw = order.raw as Record<string, unknown> | undefined
  const rawStatus =
    raw != null
      ? String(
          raw.statusDesc ??
            raw.status_desc ??
            raw.statusName ??
            raw.tradeStatus ??
            '',
        )
      : ''
  return isStatusSignedFromTexts(order.orderStatusText, rawStatus)
}

export function isStatusSignedView(v: AnalyzedOrderView): boolean {
  return isStatusSignedFromTexts(v.orderStatusText)
}

const SHIPPED_OUT_KEYWORDS = ['已发货', '待收货', '运输中', '派送中', '待签收'] as const

/** 已发出（在途），不含待配货/待发货、已关闭/已取消、已签收完成 */
export function isShippedOutOrderView(v: AnalyzedOrderView): boolean {
  if (!v.includedInGmv) return false
  const text = (v.orderStatusText ?? '').trim()
  if (!text) return false
  if (text.includes('已发货未签收')) return true
  if (/已取消|已关闭|交易关闭|待配货|待发货|未支付/.test(text)) return false
  if (text.includes('未签收') && !text.includes('已发货')) return false
  if (isStatusSignedFromTexts(text)) return false
  return containsAny(text, SHIPPED_OUT_KEYWORDS)
}
