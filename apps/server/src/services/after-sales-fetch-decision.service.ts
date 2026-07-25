import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'
import {
  isCompletedAfterSaleStatusText,
  isStaleEmptyWorkbenchForOrder,
  orderSignalsCompletedAfterSale,
} from './completed-after-sale-status.service'

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
  /** 缓存 fetchStatus（入队资格用） */
  cacheFetchStatus?: string | null
}

export type AfterSalesQueueSignalType =
  | 'official_quality_case'
  | 'active_after_sale'
  | 'completed_after_sale'
  | 'returned_flag'
  | 'raw_after_sale_id'
  | 'refund_amount'
  | 'stale_cache'
  | 'no_signal'

export interface AfterSalesQueueEligibility {
  eligible: boolean
  reason: string
  priority: number
  signalType: AfterSalesQueueSignalType
}

/** 优先级（与产品规格一致） */
export const AFTER_SALES_QUEUE_PRIORITY = {
  OFFICIAL_QUALITY: 100,
  RETURN_IN_TRANSIT: 90,
  PROCESSING: 85,
  COMPLETED_MISSING_DETAIL: 75,
  CACHE_STALE: 60,
  NORMAL_RETRY: 40,
  NONE: 0,
} as const

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
  // 不用裸「待收货」：物流订单态也是「待收货」，会误判；售后用「待商家收货」等
  '待商家收货',
  '待审核',
  '待退货',
  '待寄回',
  '买家退货中',
  '退货退款成功',
]

const ACTIVE_AFTER_SALE_KEYWORDS = [
  '待审核',
  '售后处理中',
  '退款中',
  '待退货',
  '待寄回',
  '买家退货中',
  '待商家收货',
]

const RETURN_IN_TRANSIT_KEYWORDS = ['待商家收货', '买家退货中', '待寄回', '待退货']

const PROCESSING_KEYWORDS = ['退款中', '售后处理中', '待审核']

const COMPLETED_AFTER_SALE_KEYWORDS = [
  '退款成功',
  '退货退款成功',
  '售后完成',
  '售后关闭',
  '已退款',
]

const ORDER_STATUS_FETCH_KEYWORDS = [
  '售后关闭',
  '退款关闭',
  '退款成功',
  '退货退款',
  '仅退款',
  '售后处理中',
]

const ID_FIELD_KEYS = new Set([
  'returns_id',
  'returnId',
  'return_id',
  'latestReturnsId',
  'latest_returns_id',
  'refundId',
  'refund_id',
  'afterSaleId',
  'after_sale_id',
])

const STATUS_FIELD_KEYS = new Set([
  'afterSaleStatus',
  'after_sale_status',
  'firstAfterSaleStatus',
  'secondAfterSaleStatus',
  'refundStatus',
  'refund_status',
])

const AMOUNT_FIELD_KEYS = new Set([
  'refundAmount',
  'refund_amount',
  'refund_fee',
  'refundFee',
  'expected_refund_amount',
  'expectedRefundAmount',
  'applied_amount',
  'appliedAmount',
])

const OBJECT_FIELD_KEYS = new Set([
  'afterSaleInfo',
  'after_sale_info',
  'afterSaleList',
  'after_sale_list',
  'after_sales',
  'afterSale',
  'after_sale',
])

const RAW_AFTER_SALE_KEYS = [
  ...ID_FIELD_KEYS,
  ...STATUS_FIELD_KEYS,
  ...AMOUNT_FIELD_KEYS,
  ...OBJECT_FIELD_KEYS,
]

const NO_AFTER_SALE_EXPLICIT = ['无售后', '—', '-', 'none', 'null', 'undefined', '无']

const MEANINGLESS_STRINGS = new Set([
  '',
  '0',
  'none',
  'null',
  'undefined',
  '无售后',
  '-',
  '—',
  '无',
])

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
      '待商家收货',
      '退款中',
    ].some((k) => normalized.includes(k.replace(/\s+/g, '')))
    if (!hasRealAfterSale) return false
  }
  return AFTER_SALE_STATUS_KEYWORDS.some((k) => normalized.includes(k.replace(/\s+/g, '')))
}

function textHasAnyKeyword(text: string, keywords: string[]): boolean {
  if (!text) return false
  const normalized = text.replace(/\s+/g, '')
  return keywords.some((k) => normalized.includes(k.replace(/\s+/g, '')))
}

export function hasMeaningfulAfterSaleId(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  const s = String(value).trim()
  if (!s) return false
  if (MEANINGLESS_STRINGS.has(s.toLowerCase()) || MEANINGLESS_STRINGS.has(s)) return false
  if (/^0+(\.0+)?$/.test(s)) return false
  return true
}

/**
 * 状态字段：0/"0"/1/"1"/none/无售后为 false。
 * 小红书订单 raw：afterSaleStatus=1 表示「无售后」；真实售后常见 2/3/5/6/7…
 */
export function hasMeaningfulAfterSaleStatus(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false
    // 0=空，1=无售后，负数（如 secondAfterSaleStatus=-1）无意义
    return value > 1
  }
  const s = String(value).trim()
  if (!s) return false
  const lower = s.toLowerCase()
  if (MEANINGLESS_STRINGS.has(lower) || MEANINGLESS_STRINGS.has(s)) return false
  if (/^0+(\.0+)?$/.test(s)) return false
  if (textHasAfterSaleKeyword(s)) return true
  // 纯数字字符串：与数值口径一致，1 不算信号
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) && n > 1
  }
  return false
}

export function hasPositiveRefundAmount(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return false
    // API 多为元；>0 即有退款金额信号（不区分元/分）
    return value > 0
  }
  const s = String(value).trim().replace(/,/g, '')
  if (!s) return false
  if (MEANINGLESS_STRINGS.has(s.toLowerCase()) || MEANINGLESS_STRINGS.has(s)) return false
  if (/^0+(\.0+)?$/.test(s)) return false
  const n = Number(s)
  return Number.isFinite(n) && n > 0
}

function objectHasMeaningfulAfterSaleSignal(obj: Record<string, unknown>, depth = 0): boolean {
  if (depth > 3) return false
  for (const [k, v] of Object.entries(obj)) {
    if (ID_FIELD_KEYS.has(k) && hasMeaningfulAfterSaleId(v)) return true
    if (STATUS_FIELD_KEYS.has(k) && hasMeaningfulAfterSaleStatus(v)) return true
    if (AMOUNT_FIELD_KEYS.has(k) && hasPositiveRefundAmount(v)) return true
    if (typeof v === 'string' && textHasAfterSaleKeyword(v)) return true
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (objectHasMeaningfulAfterSaleSignal(v as Record<string, unknown>, depth + 1)) return true
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          if (objectHasMeaningfulAfterSaleSignal(item as Record<string, unknown>, depth + 1)) {
            return true
          }
        }
      }
    }
  }
  return false
}

export function hasMeaningfulAfterSaleObject(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) {
    if (value.length === 0) return false
    return value.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        objectHasMeaningfulAfterSaleSignal(item as Record<string, unknown>),
    )
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (Object.keys(obj).length === 0) return false
    return objectHasMeaningfulAfterSaleSignal(obj)
  }
  return false
}

/** raw 是否存在语义有效的售后信号（非默认 0/空对象） */
export function rawHasAfterSaleField(raw: Record<string, unknown> | undefined): boolean {
  if (!raw || typeof raw !== 'object') return false
  for (const k of RAW_AFTER_SALE_KEYS) {
    if (!(k in raw)) continue
    const v = raw[k]
    if (ID_FIELD_KEYS.has(k)) {
      if (hasMeaningfulAfterSaleId(v)) return true
      continue
    }
    if (STATUS_FIELD_KEYS.has(k)) {
      if (hasMeaningfulAfterSaleStatus(v)) return true
      continue
    }
    if (AMOUNT_FIELD_KEYS.has(k)) {
      if (hasPositiveRefundAmount(v)) return true
      continue
    }
    if (OBJECT_FIELD_KEYS.has(k)) {
      if (hasMeaningfulAfterSaleObject(v)) return true
    }
  }
  // sku 级 latestReturnsId
  const skus = raw.skus
  if (Array.isArray(skus)) {
    for (const sku of skus) {
      if (!sku || typeof sku !== 'object') continue
      const s = sku as Record<string, unknown>
      if (hasMeaningfulAfterSaleId(s.latestReturnsId ?? s.latest_returns_id ?? s.returns_id)) {
        return true
      }
      if (hasMeaningfulAfterSaleStatus(s.afterSaleStatus ?? s.after_sale_status)) return true
      if (typeof s.afterSaleStatusDesc === 'string' && textHasAfterSaleKeyword(s.afterSaleStatusDesc)) {
        return true
      }
    }
  }
  return false
}

function isOfflineOrder(input: ShouldFetchWorkbenchInput): boolean {
  const orderNo = norm(input.displayOrderNo || input.officialOrderNo)
  if (/^OFF-/i.test(orderNo) || /^offline:/i.test(orderNo)) return true
  const raw = input.raw
  if (!raw) return false
  return (
    raw.dealSource === 'offline' ||
    raw.sourceType === 'offline_deal' ||
    Boolean(raw.offlineDealKey) ||
    Boolean(raw.offlineDealId)
  )
}

/** 已签收/已完成且明确无售后、raw 无售后字段 → 可跳过工作台查询 */
export function canSkipAfterSalesWorkbenchFetch(input: ShouldFetchWorkbenchInput): boolean {
  if (isCompletedAfterSaleStatusText(input.afterSaleStatusText)) return false

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
    if (rawHasAfterSaleField(input.raw)) return false
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
  return resolveAfterSalesQueueEligibility(input).eligible
}

export function hasAfterSaleSignal(input: ShouldFetchWorkbenchInput): boolean {
  const text = combinedStatusText(input)
  if (textHasAfterSaleKeyword(text)) return true
  if (ORDER_STATUS_FETCH_KEYWORDS.some((k) => text.includes(k))) return true
  if (input.isReturned || input.isReturnRefund || input.isRefundOnly) return true
  if ((input.buyerProductRefundAmountCent ?? 0) > 0) return true
  if ((input.afterSalesWorkbenchRefundAmountCent ?? 0) > 0) return true
  if (rawHasAfterSaleField(input.raw)) return true
  return false
}

function priorityForSignal(
  signalType: AfterSalesQueueSignalType,
  text: string,
): number {
  switch (signalType) {
    case 'official_quality_case':
      return AFTER_SALES_QUEUE_PRIORITY.OFFICIAL_QUALITY
    case 'active_after_sale':
      if (textHasAnyKeyword(text, RETURN_IN_TRANSIT_KEYWORDS)) {
        return AFTER_SALES_QUEUE_PRIORITY.RETURN_IN_TRANSIT
      }
      if (textHasAnyKeyword(text, PROCESSING_KEYWORDS)) {
        return AFTER_SALES_QUEUE_PRIORITY.PROCESSING
      }
      return AFTER_SALES_QUEUE_PRIORITY.PROCESSING
    case 'completed_after_sale':
      return AFTER_SALES_QUEUE_PRIORITY.COMPLETED_MISSING_DETAIL
    case 'returned_flag':
    case 'raw_after_sale_id':
    case 'refund_amount':
      return AFTER_SALES_QUEUE_PRIORITY.PROCESSING
    case 'stale_cache':
      return AFTER_SALES_QUEUE_PRIORITY.CACHE_STALE
    default:
      return AFTER_SALES_QUEUE_PRIORITY.NONE
  }
}

/**
 * 售后队列唯一入队资格判定（金额不参与）。
 */
export function resolveAfterSalesQueueEligibility(
  input: ShouldFetchWorkbenchInput,
  options?: {
    officialQualityCaseMatched?: boolean
    cacheMissingOrStale?: boolean
    /** 缓存是否仍有效（success/empty 且未过期） */
    cacheCurrentlyValid?: boolean
  },
): AfterSalesQueueEligibility {
  const orderNo = norm(input.displayOrderNo || input.officialOrderNo)
  const none = (reason: string): AfterSalesQueueEligibility => ({
    eligible: false,
    reason,
    priority: AFTER_SALES_QUEUE_PRIORITY.NONE,
    signalType: 'no_signal',
  })

  if (!orderNo || !/^P/i.test(orderNo)) {
    return none('invalid_order_no')
  }
  if (isOfflineOrder(input)) {
    return none('offline_order')
  }

  const text = combinedStatusText(input)
  const cacheValid = options?.cacheCurrentlyValid === true
  const cacheMissingOrStale = options?.cacheMissingOrStale === true
  const cacheStatus = norm(input.cacheFetchStatus).toLowerCase()

  const make = (
    signalType: Exclude<AfterSalesQueueSignalType, 'no_signal'>,
    reason: string,
  ): AfterSalesQueueEligibility => ({
    eligible: true,
    reason,
    priority: priorityForSignal(signalType, text),
    signalType,
  })

  // 有效缓存且无「必须重开」时不入队（官方品退缺详情除外）
  if (cacheValid && !options?.officialQualityCaseMatched) {
    return none('cache_still_valid')
  }

  if (options?.officialQualityCaseMatched && (cacheMissingOrStale || !cacheValid)) {
    return make('official_quality_case', 'official_quality_case_needs_detail')
  }

  if (cacheValid && options?.officialQualityCaseMatched) {
    return none('official_quality_cache_ok')
  }

  // 明确售后文案
  if (textHasAnyKeyword(text, ACTIVE_AFTER_SALE_KEYWORDS) || textHasAnyKeyword(text, [
    '仅退款',
    '退货退款',
  ])) {
    return make('active_after_sale', 'active_after_sale_status')
  }

  if (
    isCompletedAfterSaleStatusText(input.afterSaleStatusText) ||
    textHasAnyKeyword(text, COMPLETED_AFTER_SALE_KEYWORDS) ||
    textHasAnyKeyword(text, ['其他售后', '售后关闭', '售后完成'])
  ) {
    if (cacheValid) return none('completed_cache_valid')
    return make('completed_after_sale', 'completed_after_sale_needs_detail')
  }

  if (input.isReturned === true) {
    if (cacheValid) return none('returned_cache_valid')
    return make('returned_flag', 'is_returned')
  }

  if (rawHasAfterSaleField(input.raw)) {
    // 区分 ID vs 金额
    const raw = input.raw!
    let hasId = false
    let hasAmt = false
    for (const k of ID_FIELD_KEYS) {
      if (k in raw && hasMeaningfulAfterSaleId(raw[k])) hasId = true
    }
    for (const k of AMOUNT_FIELD_KEYS) {
      if (k in raw && hasPositiveRefundAmount(raw[k])) hasAmt = true
    }
    if (Array.isArray(raw.skus)) {
      for (const sku of raw.skus) {
        if (!sku || typeof sku !== 'object') continue
        const s = sku as Record<string, unknown>
        if (hasMeaningfulAfterSaleId(s.latestReturnsId ?? s.returns_id)) hasId = true
      }
    }
    if (cacheValid) return none('raw_signal_cache_valid')
    if (hasId) return make('raw_after_sale_id', 'meaningful_after_sale_id')
    if (hasAmt) return make('refund_amount', 'positive_refund_amount')
    return make('active_after_sale', 'raw_after_sale_signal')
  }

  if ((input.buyerProductRefundAmountCent ?? 0) > 0) {
    if (cacheValid) return none('refund_cent_cache_valid')
    return make('refund_amount', 'buyer_product_refund_amount')
  }

  if ((input.afterSalesWorkbenchRefundAmountCent ?? 0) > 0) {
    if (cacheValid) return none('wb_refund_cache_valid')
    return make('refund_amount', 'workbench_refund_amount')
  }

  const src = norm(input.buyerProductRefundSource)
  if (src === 'after_sales_workbench_pending' || src === 'pending') {
    return make('stale_cache', 'refund_source_pending')
  }

  if (
    cacheMissingOrStale ||
    cacheStatus === 'failed' ||
    cacheStatus === 'pending'
  ) {
    // 仅当已有售后信号时，缓存失效才入队；无信号不因 failed 空刷
    if (hasAfterSaleSignal(input)) {
      return make('stale_cache', `cache_${cacheStatus || 'missing_or_stale'}`)
    }
  }

  if (textHasAfterSaleKeyword(text) || ORDER_STATUS_FETCH_KEYWORDS.some((k) => text.includes(k))) {
    if (cacheValid) return none('keyword_cache_valid')
    return make('active_after_sale', 'after_sale_keyword')
  }

  if (input.isReturnRefund || input.isRefundOnly || input.isFreightRefundOnly) {
    if (cacheValid) return none('refund_flag_cache_valid')
    return make('completed_after_sale', 'refund_type_flag')
  }

  return none('no_after_sale_signal')
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

/** 主表已有售后完成信号时，empty/no_record 不可当作最终结论 */
export function isTrustworthyResolvedRefundSource(
  source: string | undefined | null,
  afterSaleStatusText?: string | null,
  isReturned?: boolean,
): boolean {
  const s = norm(source)
  if (!isResolvedRefundSource(s)) return false
  const completed =
    isCompletedAfterSaleStatusText(afterSaleStatusText) || isReturned === true
  if (completed && s === 'after_sales_workbench_no_record') return false
  return true
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

  const afterText = [input.afterSaleStatusText, input.afterSaleStatusLabel].filter(Boolean).join(' ')
  if (
    workbench &&
    isStaleEmptyWorkbenchForOrder(
      {
        afterSaleStatusText: afterText,
        isReturned: input.isReturned === true,
        orderStatusText: input.orderStatusText ?? '',
      },
      workbench,
    )
  ) {
    return true
  }

  if (
    isTrustworthyResolvedRefundSource(
      resolvedRefundSource,
      afterText,
      input.isReturned,
    )
  ) {
    return false
  }

  const wbStatus = resolveWorkbenchFetchStatus(workbench)
  if (wbStatus === 'success' || wbStatus === 'zero_refund') {
    return false
  }
  if (wbStatus === 'no_record') {
    return orderSignalsCompletedAfterSale({
      afterSaleStatusText: afterText,
      isReturned: input.isReturned === true,
      orderStatusText: input.orderStatusText ?? '',
    })
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
