import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'

export interface ShouldFetchWorkbenchInput {
  orderStatusText?: string
  afterSaleStatusText?: string
  /** 展示用订单状态（如「售后关闭」） */
  orderStatusLabel?: string
  /** 展示用售后状态（如「其他售后」） */
  afterSaleStatusLabel?: string
  raw?: Record<string, unknown>
  isReturned?: boolean
  isReturnRefund?: boolean
  isRefundOnly?: boolean
  isFreightRefundOnly?: boolean
  afterSaleClosedNoRefund?: boolean
  displayOrderNo?: string
  officialOrderNo?: string
  buyerProductRefundAmountCent?: number
  buyerProductRefundSource?: string
  afterSalesWorkbenchRefundAmountCent?: number
}

const AFTER_SALE_STATUS_KEYWORDS = [
  '售后',
  '其他售后',
  '售后关闭',
  '售后完成',
  '售后处理中',
  '退款',
  '退货',
  '退货退款',
  '仅退款',
  '运费补偿',
  '已退款',
  '退款成功',
  '待商家收货',
  '退款中',
  '待收货',
]

const ORDER_STATUS_FETCH_KEYWORDS = [
  '售后关闭',
  '退款关闭',
  '退款成功',
  '退货退款',
  '仅退款',
  '售后处理中',
]

const RAW_AFTER_SALE_KEYS = [
  'returns_id',
  'returnId',
  'return_id',
  'refundId',
  'refund_id',
  'afterSaleId',
  'after_sale_id',
  'afterSaleStatus',
  'after_sale_status',
  'afterSaleInfo',
  'after_sale_info',
  'afterSaleList',
  'after_sale_list',
  'after_sales',
  'refundStatus',
  'refund_status',
  'refundAmount',
  'refund_amount',
  'refund_fee',
]

const NO_AFTER_SALE_EXPLICIT = ['无售后', '—', '-', 'none', 'null', 'undefined', '无']

function norm(s: string | undefined | null): string {
  return (s ?? '').trim()
}

function combinedStatusText(input: ShouldFetchWorkbenchInput): string {
  return [
    input.orderStatusText,
    input.afterSaleStatusText,
    input.orderStatusLabel,
    input.afterSaleStatusLabel,
  ]
    .filter(Boolean)
    .join(' ')
}

/** 「无售后」不算售后信号；「其他售后」等仍算 */
function textHasAfterSaleKeyword(text: string): boolean {
  if (!text) return false
  const normalized = text.replace(/\s+/g, '')
  if (normalized.includes('无售后')) {
    const hasRealAfterSale = [
      '其他售后',
      '售后关闭',
      '售后完成',
      '售后处理中',
      '退货退款',
      '仅退款',
      '退款成功',
      '运费补偿',
    ].some((k) => normalized.includes(k.replace(/\s+/g, '')))
    if (!hasRealAfterSale) return false
  }
  return AFTER_SALE_STATUS_KEYWORDS.some((k) => normalized.includes(k.replace(/\s+/g, '')))
}

function rawHasAfterSaleField(raw: Record<string, unknown> | undefined): boolean {
  if (!raw || typeof raw !== 'object') return false
  for (const k of RAW_AFTER_SALE_KEYS) {
    const v = raw[k]
    if (v == null || v === '') continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (Object.keys(v as object).length === 0) continue
      return true
    }
    if (Array.isArray(v) && v.length > 0) return true
    if (String(v).trim()) return true
  }
  const nested = [raw.afterSaleInfo, raw.after_sale_info, raw.afterSale, raw.after_sale]
  for (const n of nested) {
    if (n && typeof n === 'object' && Object.keys(n as object).length > 0) return true
  }
  return false
}

/** 已签收/已完成且明确无售后、raw 无售后字段 → 可跳过工作台查询 */
export function canSkipAfterSalesWorkbenchFetch(input: ShouldFetchWorkbenchInput): boolean {
  const text = combinedStatusText(input)
  const orderPart = [input.orderStatusText, input.orderStatusLabel].filter(Boolean).join(' ')
  const afterPart = [input.afterSaleStatusText, input.afterSaleStatusLabel].filter(Boolean).join(' ')

  const signedOrDone =
    /已签收|已完成/.test(orderPart) || /已签收|已完成/.test(text)
  if (!signedOrDone) return false

  const afterExplicitEmpty =
    !afterPart ||
    NO_AFTER_SALE_EXPLICIT.some((k) => afterPart === k || afterPart.includes('无售后'))

  if (afterExplicitEmpty) {
    if (input.isReturned || input.isReturnRefund || input.isRefundOnly) return false
    if (ORDER_STATUS_FETCH_KEYWORDS.some((k) => text.includes(k))) return false
    if (textHasAfterSaleKeyword(text)) return false
    return true
  }

  if (rawHasAfterSaleField(input.raw)) return false
  if (input.isReturned || input.isReturnRefund || input.isRefundOnly) return false
  if (textHasAfterSaleKeyword(text)) return false
  if (ORDER_STATUS_FETCH_KEYWORDS.some((k) => text.includes(k))) return false

  return true
}

/**
 * 是否需要查询售后工作台 returns/v3
 */
export function shouldFetchAfterSalesWorkbench(input: ShouldFetchWorkbenchInput): boolean {
  const orderNo = norm(input.displayOrderNo || input.officialOrderNo)
  if (!orderNo || !/^P/i.test(orderNo)) return false

  const src = norm(input.buyerProductRefundSource)
  if (src === 'after_sales_workbench_pending' || src === 'pending') {
    return true
  }

  if (canSkipAfterSalesWorkbenchFetch(input)) return false

  if (
    input.afterSalesWorkbenchRefundAmountCent == null &&
    (hasAfterSaleSignal(input) || rawHasAfterSaleField(input.raw))
  ) {
    return true
  }

  if (
    hasAfterSaleSignal(input) &&
    (input.buyerProductRefundAmountCent ?? 0) <= 0 &&
    src !== 'no_after_sale' &&
    src !== 'after_sales_workbench' &&
    src !== 'after_sales_workbench_no_record' &&
    src !== 'after_sales_workbench_zero_refund'
  ) {
    return true
  }

  const text = combinedStatusText(input)
  if (textHasAfterSaleKeyword(text)) return true
  if (ORDER_STATUS_FETCH_KEYWORDS.some((k) => text.includes(k))) return true

  if (input.isReturned || input.isReturnRefund || input.isRefundOnly || input.isFreightRefundOnly) {
    return true
  }

  if (rawHasAfterSaleField(input.raw)) return true

  return false
}

export function hasAfterSaleSignal(input: ShouldFetchWorkbenchInput): boolean {
  const text = combinedStatusText(input)
  if (textHasAfterSaleKeyword(text)) return true
  if (ORDER_STATUS_FETCH_KEYWORDS.some((k) => text.includes(k))) return true
  if (input.isReturned || input.isReturnRefund || input.isRefundOnly) return true
  if (rawHasAfterSaleField(input.raw)) return true
  return false
}

export function shouldFetchInputFromNormalizedOrder(order: NormalizedOrder): ShouldFetchWorkbenchInput {
  return {
    orderStatusText: order.orderStatusText,
    afterSaleStatusText: order.afterSaleStatusText,
    raw: order.raw,
    isReturned: order.isReturned,
    displayOrderNo: order.displayOrderNo,
    officialOrderNo: order.officialOrderNo,
  }
}

export function shouldFetchInputFromView(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
): ShouldFetchWorkbenchInput {
  const ext = v as AnalyzedOrderView & { afterSaleDisplayType?: string }
  return {
    orderStatusText: v.orderStatusText,
    afterSaleStatusText: v.afterSaleStatusText,
    orderStatusLabel: buildOrderStatusLabelForFetch(v),
    afterSaleStatusLabel: ext.afterSaleDisplayType ?? v.afterSaleStatusLabel,
    raw: v.raw,
    isReturned: v.isReturned,
    isReturnRefund: v.isReturnRefund,
    isRefundOnly: v.isRefundOnly,
    isFreightRefundOnly: v.isFreightRefundOnly,
    afterSaleClosedNoRefund: v.afterSaleClosedNoRefund,
    displayOrderNo: v.displayOrderNo,
    officialOrderNo: v.officialOrderNo,
    buyerProductRefundAmountCent: v.buyerProductRefundAmountCent,
    buyerProductRefundSource: v.buyerProductRefundSource,
    afterSalesWorkbenchRefundAmountCent: v.afterSalesWorkbenchRefundAmountCent,
  }
}

function buildOrderStatusLabelForFetch(v: AnalyzedOrderView): string {
  if (v.isActualSigned) return '已签收'
  if (v.afterSaleClosedNoRefund && v.isSigned) return '已完成'
  if (v.isReturnRefund) return '售后关闭'
  return v.orderStatusText || ''
}

export type WorkbenchResolvedStatus =
  | 'success'
  | 'no_record'
  | 'zero_refund'
  | 'failed'
  | 'auth_failed'
  | 'stale'
  | 'pending'
  | 'none'

const RESOLVED_REFUND_SOURCES = new Set([
  'after_sales_workbench',
  'after_sales_workbench_expected',
  'after_sales_workbench_applied',
  'after_sales_workbench_no_record',
  'after_sales_workbench_zero_refund',
  'no_after_sale',
])

export function isResolvedRefundSource(source: string | undefined | null): boolean {
  const s = norm(source)
  return RESOLVED_REFUND_SOURCES.has(s)
}

/** 工作台缓存查询结果（用于 pending 判定） */
export function resolveWorkbenchFetchStatus(
  workbench?: AfterSalesWorkbenchRefund | null,
): WorkbenchResolvedStatus {
  if (!workbench) return 'none'
  if (workbench.fetchStatus === 'pending') return 'pending'
  if (workbench.fetchStatus === 'failed') {
    const err = (workbench.fetchError ?? '').toLowerCase()
    if (/cookie|登录|auth|未配置|401|403/.test(err)) return 'auth_failed'
    return 'failed'
  }
  if (workbench.fetchStatus === 'empty') return 'no_record'
  if (workbench.fetchStatus === 'success') {
    if (workbench.officialRefundAmountCent > 0 || workbench.successReturnCount > 0) {
      return 'success'
    }
    return 'zero_refund'
  }
  if (workbench.fetchedAt) {
    const ageMs = Date.now() - workbench.fetchedAt.getTime()
    if (ageMs > 7 * 24 * 60 * 60 * 1000) return 'stale'
  }
  return 'none'
}

/**
 * 是否仍缺售后工作台结果（与 shouldFetch 分离）
 * 有明确结果 → false；仅缺 cache / 失败 / 未解析 → true
 */
export function isAfterSalesResultPending(
  input: ShouldFetchWorkbenchInput,
  workbench?: AfterSalesWorkbenchRefund | null,
  resolvedRefundSource?: string | null,
): boolean {
  if (!shouldFetchAfterSalesWorkbench(input)) return false

  if (isResolvedRefundSource(resolvedRefundSource)) return false

  const wbStatus = resolveWorkbenchFetchStatus(workbench)
  if (wbStatus === 'success' || wbStatus === 'no_record' || wbStatus === 'zero_refund') {
    return false
  }
  if (wbStatus === 'failed' || wbStatus === 'auth_failed' || wbStatus === 'pending') {
    return true
  }
  if (wbStatus === 'stale') return true

  if (resolvedRefundSource === 'after_sales_workbench_pending') return true

  return true
}

/** @deprecated 使用 isAfterSalesResultPending */
export function workbenchCacheNeedsSync(
  input: ShouldFetchWorkbenchInput,
  cached?: AfterSalesWorkbenchRefund | null,
): boolean {
  return isAfterSalesResultPending(input, cached, null)
}
