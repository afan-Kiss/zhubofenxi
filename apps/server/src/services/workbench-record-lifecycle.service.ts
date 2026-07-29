/**
 * 售后工作台单条记录生命周期（纯函数）
 * REJECTED/CANCELED/CLOSED 仍是真实售后，不得当 empty / 无限重试
 */
export type WorkbenchRecordLifecycle =
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REJECTED'
  | 'CANCELED'
  | 'CLOSED'
  | 'UNKNOWN'

const REJECTED_KEYWORDS = [
  '审核拒绝',
  '商家拒绝',
  '平台拒绝',
  '拒绝退款',
  '驳回',
  '已拒绝',
] as const

const CANCELED_KEYWORDS = [
  '已取消',
  '已撤销',
  '用户取消',
  '用户撤销',
  '买家取消',
  '取消售后',
  '售后取消',
  '买家取消售后',
] as const

const CLOSED_KEYWORDS = ['已关闭', '售后关闭', '关闭售后'] as const

const PROCESSING_KEYWORDS = [
  '待商家审核',
  '待审核',
  '待商家收货',
  '待收货',
  '待退货',
  '待寄回',
  '退款中',
  '售后处理中',
  '处理中',
  '进行中',
  '待处理',
  '买家退货中',
  '商家处理中',
] as const

const SUCCESS_KEYWORDS = [
  '售后完成',
  '退款成功',
  '已退款',
  '退货退款成功',
  '完成',
] as const

function statusText(record: Record<string, unknown>): string {
  return [
    record.refund_status_name,
    record.refundStatusName,
    record.status_name,
    record.statusName,
    record.status_desc,
    record.statusDesc,
    record.returns_status,
    record.returnsStatus,
  ]
    .filter(Boolean)
    .join(' ')
}

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

export function resolveWorkbenchRecordLifecycle(
  record: Record<string, unknown>,
): WorkbenchRecordLifecycle {
  const text = statusText(record)
  const refunded = record.refunded === true || record.refund_success === true

  // 成功优先（有明确成功文案或退款成功标记）
  if (includesAny(text, SUCCESS_KEYWORDS) && (refunded || /成功|已退款|完成/.test(text))) {
    return 'SUCCESS'
  }
  if (refunded && /成功|已退款|完成/.test(text)) return 'SUCCESS'

  if (includesAny(text, REJECTED_KEYWORDS)) return 'REJECTED'
  if (includesAny(text, CANCELED_KEYWORDS)) return 'CANCELED'
  if (includesAny(text, CLOSED_KEYWORDS)) return 'CLOSED'
  if (includesAny(text, PROCESSING_KEYWORDS)) return 'PROCESSING'

  // 兼容旧 isSuccessfulAfterSale 语义：refunded+金额在聚合层再判；此处无文案时 UNKNOWN
  if (!text.trim()) return 'UNKNOWN'
  return 'UNKNOWN'
}

/** 缓存/TTL：是否终端态（拒绝/取消/关闭） */
export function isTerminalWorkbenchStatusText(status: string | null | undefined): boolean {
  const text = String(status ?? '')
  return (
    includesAny(text, REJECTED_KEYWORDS) ||
    includesAny(text, CANCELED_KEYWORDS) ||
    includesAny(text, CLOSED_KEYWORDS)
  )
}

/** 缓存/TTL：是否进行中 */
export function isProcessingWorkbenchStatusText(status: string | null | undefined): boolean {
  const text = String(status ?? '')
  if (isTerminalWorkbenchStatusText(text)) return false
  return includesAny(text, PROCESSING_KEYWORDS)
}

/** 生命周期摘要是否含 PROCESSING / UNKNOWN（需短 TTL） */
export function lifecycleSummaryNeedsShortTtl(
  summary: string | null | undefined,
): boolean {
  const s = String(summary ?? '')
  return /(?:^|,)(?:PROCESSING|UNKNOWN)(?:,|$)/.test(s)
}

export function dedupeStatusTexts(statuses: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of statuses) {
    const t = s.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out.join('；')
}
