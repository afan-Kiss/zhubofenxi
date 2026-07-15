/**
 * 售后工作台缓存有效性：empty 不可永久可信，需结合主表售后信号与 TTL
 */
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'
import {
  isStaleEmptyWorkbenchForOrder,
  orderSignalsCompletedAfterSale,
} from './completed-after-sale-status.service'
import {
  canSkipAfterSalesWorkbenchFetch,
  hasAfterSaleSignal,
} from './after-sales-fetch-decision.service'

/** empty 缓存最长有效期：超过后即使仍无售后信号也要重新补查 */
export const WORKBENCH_EMPTY_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** 时间范围售后缓存 TTL：过期后不得永久 fromCache */
export const TIME_SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000

/** 售后算法 / 缓存语义版本：bump 后强制重建经营缓存 */
export const AFTER_SALES_METRICS_VERSION = 'after-sales-cache-v2'

export interface OrderAfterSaleContext {
  orderStatusText?: string | null
  afterSaleStatusText?: string | null
  isReturned?: boolean | null
  raw?: Record<string, unknown>
}

export interface WorkbenchCacheSnapshot {
  fetchStatus: string
  fetchedAt?: Date | null
  updatedAt?: Date | null
  officialRefundAmountCent?: number | null
  successReturnCount?: number | null
  hasReturnRefund?: boolean | null
  hasRefundOnly?: boolean | null
  freightRefundAmountCent?: number | null
}

export function toWorkbenchLikeForStaleCheck(
  cache: WorkbenchCacheSnapshot,
): AfterSalesWorkbenchRefund {
  return {
    orderNo: '',
    packageId: null,
    officialRefundAmountCent: cache.officialRefundAmountCent ?? 0,
    expectedRefundAmountCent: 0,
    appliedAmountCent: 0,
    appliedShipFeeAmountCent: 0,
    payAmountCent: 0,
    settlementAmountCent: 0,
    refundIncludesFreight: false,
    hasFreightOnlyRefund: (cache.freightRefundAmountCent ?? 0) > 0,
    buyerUserId: null,
    afterSaleReason: null,
    afterSaleStatus: null,
    successReturnCount: cache.successReturnCount ?? 0,
    returnsIds: [],
    fetchStatus: cache.fetchStatus as AfterSalesWorkbenchRefund['fetchStatus'],
    fetchError: null,
    fetchedAt: cache.fetchedAt ?? cache.updatedAt ?? new Date(0),
    freightRefundAmountCent: cache.freightRefundAmountCent ?? 0,
  }
}

function cacheAgeMs(cache: WorkbenchCacheSnapshot, now: number): number | null {
  const t = cache.fetchedAt?.getTime() ?? cache.updatedAt?.getTime()
  if (t == null || !Number.isFinite(t) || t <= 0) return null
  return Math.max(0, now - t)
}

function orderCtxForSignal(order: OrderAfterSaleContext) {
  return {
    orderStatusText: order.orderStatusText ?? '',
    afterSaleStatusText: order.afterSaleStatusText ?? '',
    isReturned: order.isReturned === true,
  }
}

/** empty 是否因主表售后信号或 TTL 失效 */
export function isEmptyWorkbenchCacheStale(
  cache: WorkbenchCacheSnapshot,
  order: OrderAfterSaleContext,
  now = Date.now(),
): boolean {
  if (cache.fetchStatus !== 'empty') return false
  const wb = toWorkbenchLikeForStaleCheck(cache)
  const signal = orderCtxForSignal(order)
  if (isStaleEmptyWorkbenchForOrder(signal, wb)) return true
  if (orderSignalsCompletedAfterSale(signal)) return true
  if (hasAfterSaleSignal({ ...signal, raw: order.raw })) return true
  const age = cacheAgeMs(cache, now)
  if (age == null || age > WORKBENCH_EMPTY_CACHE_TTL_MS) return true
  return false
}

/**
 * 工作台缓存是否仍可作为「无需再补查」的可信结果
 * - success：数据完整时可信
 * - empty：仅订单当前仍明确无售后且未过期时可信
 * - failed / auth_failed / pending / stale：不可信
 */
export function isWorkbenchCacheCurrentlyValid(
  cache: WorkbenchCacheSnapshot | null | undefined,
  order: OrderAfterSaleContext,
  now = Date.now(),
): boolean {
  if (!cache) return false
  const status = (cache.fetchStatus ?? '').trim()
  if (!status || status === 'pending' || status === 'failed' || status === 'auth_failed' || status === 'stale') {
    return false
  }

  const signal = orderCtxForSignal(order)

  if (status === 'success') {
    // success 视为平台已核实（含 zero_refund）；不把 pending/failed/empty 混入
    return true
  }

  if (status === 'empty') {
    if (isEmptyWorkbenchCacheStale(cache, order, now)) return false
    // 仍明确无售后（签收/完成且无售后关键词）才可跳过
    if (
      canSkipAfterSalesWorkbenchFetch({
        orderStatusText: signal.orderStatusText,
        afterSaleStatusText: signal.afterSaleStatusText,
        isReturned: signal.isReturned,
        raw: order.raw,
        displayOrderNo: 'PVALID',
      })
    ) {
      return true
    }
    if (!hasAfterSaleSignal({ ...signal, raw: order.raw }) && !orderSignalsCompletedAfterSale(signal)) {
      return true
    }
    return false
  }

  return false
}

export type WorkbenchQueueStatus =
  | 'pending'
  | 'running'
  | 'retry_wait'
  | 'done'
  | 'failed'
  | 'blocked'
  | string

/**
 * 是否应重新打开补查任务（done/failed/retry_wait 等）
 * 真正稳定且仍可信的缓存不重开
 */
export function shouldReopenWorkbenchQueueTask(params: {
  queueStatus?: WorkbenchQueueStatus | null
  cache?: WorkbenchCacheSnapshot | null
  order: OrderAfterSaleContext
  force?: boolean
  now?: number
}): boolean {
  if (params.force) return true
  const now = params.now ?? Date.now()
  const status = (params.queueStatus ?? '').trim()

  if (!status || status === 'pending') return false
  if (status === 'running') return false

  if (status === 'retry_wait' || status === 'failed' || status === 'blocked') return true

  if (status === 'done') {
    if (!isWorkbenchCacheCurrentlyValid(params.cache, params.order, now)) return true
    return false
  }

  // 未知状态：偏保守重开
  return !isWorkbenchCacheCurrentlyValid(params.cache, params.order, now)
}

/** 从订单 rawJson 抽取售后上下文 */
export function extractOrderAfterSaleContextFromRaw(
  raw: Record<string, unknown> | null | undefined,
): OrderAfterSaleContext {
  if (!raw || typeof raw !== 'object') {
    return { orderStatusText: '', afterSaleStatusText: '', isReturned: false, raw: {} }
  }
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = raw[k]
      if (v != null && String(v).trim()) return String(v).trim()
    }
    return ''
  }
  let orderStatusText =
    pick('orderStatusDesc', 'order_status_desc', 'statusDesc', 'status_desc', 'orderStatus', 'status')
  let afterSaleStatusText = pick(
    'afterSaleStatusDesc',
    'after_sale_status_desc',
    'afterSaleStatus',
    'after_sale_status',
  )
  if (afterSaleStatusText === '3') afterSaleStatusText = '售后完成'
  const pkg =
    (raw.package as Record<string, unknown> | undefined) ??
    (raw.order as Record<string, unknown> | undefined) ??
    null
  if (pkg && typeof pkg === 'object') {
    if (!orderStatusText) {
      orderStatusText = pickFrom(pkg, [
        'orderStatusDesc',
        'order_status_desc',
        'statusDesc',
        'status',
      ])
    }
    if (!afterSaleStatusText || afterSaleStatusText === '3') {
      const a = pickFrom(pkg, [
        'afterSaleStatusDesc',
        'after_sale_status_desc',
        'afterSaleStatus',
        'after_sale_status',
      ])
      afterSaleStatusText = a === '3' ? '售后完成' : a || afterSaleStatusText
    }
  }
  const combined = `${orderStatusText} ${afterSaleStatusText}`
  const isReturned = /退货|退款|售后完成|已退款|退货退款/.test(combined)
  return { orderStatusText, afterSaleStatusText, isReturned, raw }
}

function pickFrom(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}
