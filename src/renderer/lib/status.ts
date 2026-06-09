const SIGNED_KEYWORDS = ['已签收', '签收', '交易完成', '已完成', '已收货']

const REFUND_KEYWORDS = [
  '退款成功',
  '退货退款成功',
  '售后完成',
  '已退款',
  '退货完成',
  '退款完成',
]

function normalizeStatusText(text: unknown): string {
  return String(text ?? '').trim()
}

export function isSignedStatus(text: unknown): boolean {
  const value = normalizeStatusText(text)
  if (!value) return false
  return SIGNED_KEYWORDS.some((kw) => value.includes(kw))
}

export function isRefundStatus(text: unknown): boolean {
  const value = normalizeStatusText(text)
  if (!value) return false
  return REFUND_KEYWORDS.some((kw) => value.includes(kw))
}

export interface StatusMappingHeaders {
  orderStatus?: string | null
  afterSaleStatus?: string | null
}

export function buildStatusFlags(
  row: Record<string, unknown>,
  mapping: StatusMappingHeaders,
): { isSigned: boolean; isRefunded: boolean; orderStatusText: string; afterSaleStatusText: string } {
  const orderStatusText = mapping.orderStatus
    ? normalizeStatusText(row[mapping.orderStatus])
    : ''
  const afterSaleStatusText = mapping.afterSaleStatus
    ? normalizeStatusText(row[mapping.afterSaleStatus])
    : ''

  const combined = [orderStatusText, afterSaleStatusText].filter(Boolean).join(' ')

  const isSigned = isSignedStatus(orderStatusText) || isSignedStatus(combined)
  const isRefunded = isRefundStatus(orderStatusText) || isRefundStatus(afterSaleStatusText) || isRefundStatus(combined)

  return { isSigned, isRefunded, orderStatusText, afterSaleStatusText }
}
