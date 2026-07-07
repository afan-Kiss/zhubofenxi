import type { AnalyzedOrderView } from '../types/analysis'

const NO_AFTER_SALE_PHRASES = [
  '无',
  '无售后',
  '暂无售后',
  '未申请售后',
  '未发起售后',
  '未产生售后',
  '没有售后',
  '售后无',
  '售后状态无',
  '售后状态：无',
  '售后状态:无',
  '售后：无',
  '售后:无',
  '售后状态暂无',
  '售后状态：暂无',
  '售后状态:暂无',
  '退款状态无',
  '退款状态：无',
  '退款状态:无',
  '退货状态无',
  '退货状态：无',
  '退货状态:无',
  '无退款',
  '无退货',
] as const

const POSITIVE_AFTER_SALE_KEYWORDS = [
  '退款',
  '退货',
  '仅退',
  '售后中',
  '售后完成',
  '售后关闭',
  '售后申请',
  '售后处理中',
  '退款成功',
  '退款中',
  '退货退款',
  '仅退款',
  '已退款',
  '申请退款',
] as const

/** 0 元关闭类文案：不算实际退款售后 */
const ACTUAL_REFUND_EXCLUDE_SUBSTRINGS = [
  '售后关闭',
  '退款关闭',
  '关闭无退款',
] as const

/** 真实退款/退货/售后完成类关键词（不含进行中/申请类） */
const ACTUAL_REFUND_KEYWORDS = [
  '退款成功',
  '退款中',
  '退款完成',
  '退货退款成功',
  '退货退款完成',
  '退货退款',
  '仅退款',
  '已退款',
  '售后完成',
  '售后成功',
  '平台已退款',
  '商家已退款',
] as const

const AFTER_SALE_STATUS_PART_SPLIT_RE = /[\s,，、;；|｜/\\]+/

/** 按分隔符拆分售后状态组合文案（不按冒号拆） */
export function splitAfterSaleStatusParts(text: string): string[] {
  return text
    .split(AFTER_SALE_STATUS_PART_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeNoAfterSalePhrase(text: string): string {
  return text.trim().replace(/\s+/g, '')
}

/** 单个片段是否为无售后文案 */
export function isSingleNoAfterSaleText(text: string): boolean {
  const raw = text.trim()
  if (!raw || raw === '—' || raw === '-') return true
  const normalized = normalizeNoAfterSalePhrase(raw)
  return NO_AFTER_SALE_PHRASES.some((phrase) => {
    const phraseNorm = normalizeNoAfterSalePhrase(phrase)
    return normalized === phraseNorm || raw === phrase
  })
}

/** 售后状态文案表示「无售后/未申请」时返回 true（不算售后信号） */
export function isNoAfterSaleText(text: string): boolean {
  const raw = text.trim()
  if (!raw || raw === '—' || raw === '-') return true
  if (isSingleNoAfterSaleText(raw)) return true
  const parts = splitAfterSaleStatusParts(raw)
  if (parts.length === 0) return false
  return parts.every((part) => isSingleNoAfterSaleText(part))
}

function isSinglePositiveAfterSaleText(text: string): boolean {
  const raw = text.trim()
  if (!raw || isSingleNoAfterSaleText(raw)) return false
  return POSITIVE_AFTER_SALE_KEYWORDS.some((keyword) => raw.includes(keyword))
}

/** 售后状态文案表示真实售后/退款信号时返回 true */
export function isPositiveAfterSaleText(text: string): boolean {
  const raw = text.trim()
  if (!raw || isNoAfterSaleText(raw)) return false
  const parts = splitAfterSaleStatusParts(raw)
  if (parts.length > 1) {
    return parts.some((part) => isSinglePositiveAfterSaleText(part))
  }
  return isSinglePositiveAfterSaleText(raw)
}

function isSingleActualRefundAfterSaleText(text: string): boolean {
  const raw = text.trim()
  if (!raw || isSingleNoAfterSaleText(raw)) return false
  if (ACTUAL_REFUND_EXCLUDE_SUBSTRINGS.some((ex) => raw.includes(ex))) return false
  return ACTUAL_REFUND_KEYWORDS.some((keyword) => raw.includes(keyword))
}

/** 文案表示实际退款/退货/售后完成（不含 0 元关闭类） */
export function isActualRefundAfterSaleText(text: string): boolean {
  const raw = text.trim()
  if (!raw || isNoAfterSaleText(raw)) return false
  const parts = splitAfterSaleStatusParts(raw)
  if (parts.length > 1) {
    return parts.some((part) => isSingleActualRefundAfterSaleText(part))
  }
  return isSingleActualRefundAfterSaleText(raw)
}

export function resolveAfterSaleStatusCombinedText(view: AnalyzedOrderView): string {
  return [view.afterSaleStatusText, view.afterSaleStatusLabel, view.afterSaleDisplayType]
    .filter(Boolean)
    .join(' ')
}

/** 视图是否携带售后/退款状态信号（不含金额强信号） */
export function viewHasAfterSaleStatusSignal(view: AnalyzedOrderView): boolean {
  if (view.isReturnRefund || view.isRefundOnly || view.isRealProductRefund) return true
  if (view.afterSaleClosedNoRefund) return true
  if (view.isQualityReturn) return true
  const afterSale = resolveAfterSaleStatusCombinedText(view)
  if (!afterSale) return false
  if (isNoAfterSaleText(afterSale)) return false
  return isPositiveAfterSaleText(afterSale)
}
