/**
 * 售后工作台缓存有效性与队列重开决策（单一真相源）
 * success / empty 均不可永久可信；retry_wait / blocked / failed 须按状态机处理
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

/** empty 缓存最长有效期 */
export const WORKBENCH_EMPTY_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** success：售后仍进行中 */
export const WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS = 1 * 60 * 60 * 1000
/** success：售后已完成（近窗） */
export const WORKBENCH_SUCCESS_TTL_COMPLETED_MS = 12 * 60 * 60 * 1000
/** success：订单稳定结束 */
export const WORKBENCH_SUCCESS_TTL_STABLE_MS = 24 * 60 * 60 * 1000
/** success：超过 45 天关账订单延长 TTL */
export const WORKBENCH_SUCCESS_TTL_CLOSED_MS = 7 * 24 * 60 * 60 * 1000
export const WORKBENCH_RECENT_ORDER_WINDOW_MS = 45 * 24 * 60 * 60 * 1000

/** 时间范围售后缓存 TTL */
export const TIME_SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000

/** 售后算法 / 缓存语义版本：bump 后强制重建经营缓存 */
export const AFTER_SALES_METRICS_VERSION = 'after-sales-cache-v4'

const IN_PROGRESS_AFTER_SALE_RE =
  /待退货|待退款|待商家收货|退款中|售后处理中|处理中|待审核|待寄回|商家处理中|买家退货中/

const PERMANENT_FAIL_TYPES = new Set(['permanent_not_found', 'permanent_invalid'])
const BLOCKED_ERROR_TYPES = new Set([
  'cookie_missing',
  'cookie_expired',
  'http_401',
  'http_403',
  'sign_env_missing',
  'sign_python2_interpreter',
])

export interface OrderAfterSaleContext {
  orderStatusText?: string | null
  afterSaleStatusText?: string | null
  isReturned?: boolean | null
  raw?: Record<string, unknown>
  /** 订单主表 updatedAt */
  orderUpdatedAt?: Date | null
  /** 下单/支付时间，用于 45 天窗口 */
  orderTime?: Date | null
}

export interface WorkbenchCacheSnapshot {
  fetchStatus: string
  fetchedAt?: Date | null
  updatedAt?: Date | null
  officialRefundAmountCent?: number | null
  freightRefundAmountCent?: number | null
  appliedAmountCent?: number | null
  appliedShipFeeAmountCent?: number | null
  expectedRefundAmountCent?: number | null
  successReturnCount?: number | null
  returnRefundCount?: number | null
  refundOnlyCount?: number | null
  hasReturnRefund?: boolean | null
  hasRefundOnly?: boolean | null
  hasFreightOnlyRefund?: boolean | null
  afterSaleStatus?: string | null
  afterSaleReason?: string | null
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
  returnsIds?: string | null
  refundIncludesFreight?: boolean | null
}

export interface QueueExternalHealth {
  cookieHealthy?: boolean
  signEnvHealthy?: boolean
}

export type WorkbenchQueueStatus =
  | 'pending'
  | 'running'
  | 'retry_wait'
  | 'done'
  | 'failed'
  | 'blocked'
  | string

export type WorkbenchReopenDecision = {
  reopen: boolean
  reason: string
  fromStatus: string
  toStatus: 'pending' | 'unchanged'
  force: boolean
}

export type WorkbenchValidityResult = {
  valid: boolean
  reason: string
  staleEmpty: boolean
  staleSuccess: boolean
  ttlMs: number | null
  ageMs: number | null
}

export function toWorkbenchLikeForStaleCheck(
  cache: WorkbenchCacheSnapshot,
): AfterSalesWorkbenchRefund {
  const returnsIds = String(cache.returnsIds ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    orderNo: '',
    packageId: null,
    officialRefundAmountCent: cache.officialRefundAmountCent ?? 0,
    expectedRefundAmountCent: cache.expectedRefundAmountCent ?? 0,
    appliedAmountCent: cache.appliedAmountCent ?? 0,
    appliedShipFeeAmountCent: cache.appliedShipFeeAmountCent ?? 0,
    payAmountCent: 0,
    settlementAmountCent: 0,
    refundIncludesFreight: cache.refundIncludesFreight === true,
    hasFreightOnlyRefund:
      cache.hasFreightOnlyRefund === true || (cache.freightRefundAmountCent ?? 0) > 0,
    buyerUserId: null,
    afterSaleReason: cache.afterSaleReason ?? null,
    afterSaleStatus: cache.afterSaleStatus ?? null,
    successReturnCount: cache.successReturnCount ?? 0,
    returnsIds,
    hasReturnRefund: cache.hasReturnRefund === true,
    hasRefundOnly: cache.hasRefundOnly === true,
    returnRefundCount: cache.returnRefundCount ?? 0,
    refundOnlyCount: cache.refundOnlyCount ?? 0,
    afterSaleType: cache.afterSaleType ?? null,
    returnTypeCodes: cache.returnTypeCodes ?? null,
    classificationSource: cache.classificationSource ?? null,
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

export function orderHasInProgressAfterSale(order: OrderAfterSaleContext): boolean {
  const text = [
    order.orderStatusText,
    order.afterSaleStatusText,
  ]
    .filter(Boolean)
    .join(' ')
  return IN_PROGRESS_AFTER_SALE_RE.test(text)
}

export function orderAgeMs(order: OrderAfterSaleContext, now: number): number | null {
  const t = order.orderTime?.getTime()
  if (t == null || !Number.isFinite(t) || t <= 0) return null
  return Math.max(0, now - t)
}

/**
 * success 缓存 TTL：进行中 1h / 已完成近窗 12h / 稳定 24h / 45 天外关账 7d
 */
export function resolveWorkbenchCacheTtl(
  cache: WorkbenchCacheSnapshot,
  order: OrderAfterSaleContext,
  now = Date.now(),
): number {
  const status = (cache.fetchStatus ?? '').trim()
  if (status === 'empty') return WORKBENCH_EMPTY_CACHE_TTL_MS
  if (status !== 'success') return 0

  if (orderHasInProgressAfterSale(order)) return WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS

  const age = orderAgeMs(order, now)
  if (age != null && age > WORKBENCH_RECENT_ORDER_WINDOW_MS) {
    return WORKBENCH_SUCCESS_TTL_CLOSED_MS
  }

  const signal = orderCtxForSignal(order)
  const afterDone =
    orderSignalsCompletedAfterSale(signal) ||
    /售后完成|退款成功|已退款|退货退款成功/.test(signal.afterSaleStatusText)
  const orderDone = /已完成|已签收|已关闭|已取消/.test(signal.orderStatusText)
  if (afterDone && orderDone && !orderHasInProgressAfterSale(order)) {
    return WORKBENCH_SUCCESS_TTL_STABLE_MS
  }
  if (afterDone) return WORKBENCH_SUCCESS_TTL_COMPLETED_MS
  return WORKBENCH_SUCCESS_TTL_COMPLETED_MS
}

function statusesMismatch(cache: WorkbenchCacheSnapshot, order: OrderAfterSaleContext): boolean {
  const cacheStatus = (cache.afterSaleStatus ?? '').trim()
  const orderStatus = (order.afterSaleStatusText ?? '').trim()
  if (!cacheStatus || !orderStatus) return false
  if (cacheStatus === orderStatus) return false
  // 主表已进行中/已完成，缓存仍是「无售后」类
  if (/无售后|^—$|^-$/.test(cacheStatus) && (orderSignalsCompletedAfterSale(orderCtxForSignal(order)) || orderHasInProgressAfterSale(order))) {
    return true
  }
  if (orderHasInProgressAfterSale(order) && /售后完成|退款成功|已退款/.test(cacheStatus)) {
    return true
  }
  if (
    orderSignalsCompletedAfterSale(orderCtxForSignal(order)) &&
    /处理中|待退|退款中/.test(cacheStatus)
  ) {
    return true
  }
  return false
}

/** success 是否因 TTL / 主表更新 / 状态不一致而过期 */
export function isWorkbenchSuccessCacheStale(
  cache: WorkbenchCacheSnapshot,
  order: OrderAfterSaleContext,
  now = Date.now(),
): { stale: boolean; reason: string } {
  if (cache.fetchStatus !== 'success') return { stale: false, reason: 'not_success' }

  if (orderHasInProgressAfterSale(order)) {
    const age = cacheAgeMs(cache, now)
    const ttl = WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS
    if (age == null || age > ttl) {
      return { stale: true, reason: 'in_progress_after_sale_ttl' }
    }
  }

  const fetchedAt = cache.fetchedAt?.getTime() ?? cache.updatedAt?.getTime() ?? 0
  const orderUpdated = order.orderUpdatedAt?.getTime() ?? 0
  if (
    orderUpdated > 0 &&
    fetchedAt > 0 &&
    orderUpdated > fetchedAt &&
    (hasAfterSaleSignal({ ...orderCtxForSignal(order), raw: order.raw }) ||
      orderSignalsCompletedAfterSale(orderCtxForSignal(order)) ||
      orderHasInProgressAfterSale(order))
  ) {
    return { stale: true, reason: 'order_updated_after_fetch' }
  }

  if (statusesMismatch(cache, order)) {
    return { stale: true, reason: 'after_sale_status_mismatch' }
  }

  const ttl = resolveWorkbenchCacheTtl(cache, order, now)
  const age = cacheAgeMs(cache, now)
  if (age == null || age > ttl) {
    return { stale: true, reason: 'success_ttl_expired' }
  }

  return { stale: false, reason: 'ok' }
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
  if (orderHasInProgressAfterSale(order)) return true
  const age = cacheAgeMs(cache, now)
  if (age == null || age > WORKBENCH_EMPTY_CACHE_TTL_MS) return true
  return false
}

export function resolveWorkbenchCacheValidity(
  cache: WorkbenchCacheSnapshot | null | undefined,
  order: OrderAfterSaleContext,
  now = Date.now(),
): WorkbenchValidityResult {
  if (!cache) {
    return {
      valid: false,
      reason: 'no_cache',
      staleEmpty: false,
      staleSuccess: false,
      ttlMs: null,
      ageMs: null,
    }
  }
  const status = (cache.fetchStatus ?? '').trim()
  const age = cacheAgeMs(cache, now)
  const ttl = resolveWorkbenchCacheTtl(cache, order, now)

  if (!status || status === 'pending' || status === 'failed' || status === 'auth_failed' || status === 'stale') {
    return {
      valid: false,
      reason: `status_${status || 'empty'}`,
      staleEmpty: false,
      staleSuccess: false,
      ttlMs: ttl,
      ageMs: age,
    }
  }

  if (status === 'success') {
    const s = isWorkbenchSuccessCacheStale(cache, order, now)
    return {
      valid: !s.stale,
      reason: s.reason,
      staleEmpty: false,
      staleSuccess: s.stale,
      ttlMs: ttl,
      ageMs: age,
    }
  }

  if (status === 'empty') {
    const stale = isEmptyWorkbenchCacheStale(cache, order, now)
    if (stale) {
      return {
        valid: false,
        reason: 'stale_empty',
        staleEmpty: true,
        staleSuccess: false,
        ttlMs: ttl,
        ageMs: age,
      }
    }
    const signal = orderCtxForSignal(order)
    if (
      canSkipAfterSalesWorkbenchFetch({
        orderStatusText: signal.orderStatusText,
        afterSaleStatusText: signal.afterSaleStatusText,
        isReturned: signal.isReturned,
        raw: order.raw,
        displayOrderNo: 'PVALID',
      })
    ) {
      return {
        valid: true,
        reason: 'empty_no_after_sale',
        staleEmpty: false,
        staleSuccess: false,
        ttlMs: ttl,
        ageMs: age,
      }
    }
    if (!hasAfterSaleSignal({ ...signal, raw: order.raw }) && !orderSignalsCompletedAfterSale(signal)) {
      return {
        valid: true,
        reason: 'empty_no_signal',
        staleEmpty: false,
        staleSuccess: false,
        ttlMs: ttl,
        ageMs: age,
      }
    }
    return {
      valid: false,
      reason: 'empty_with_signal',
      staleEmpty: true,
      staleSuccess: false,
      ttlMs: ttl,
      ageMs: age,
    }
  }

  return {
    valid: false,
    reason: `unknown_status_${status}`,
    staleEmpty: false,
    staleSuccess: false,
    ttlMs: ttl,
    ageMs: age,
  }
}

/** @deprecated 使用 resolveWorkbenchCacheValidity */
export function isWorkbenchCacheCurrentlyValid(
  cache: WorkbenchCacheSnapshot | null | undefined,
  order: OrderAfterSaleContext,
  now = Date.now(),
): boolean {
  return resolveWorkbenchCacheValidity(cache, order, now).valid
}

/**
 * 是否应重新打开补查任务。
 * 不绕过 nextAttemptAt；不自动恢复 blocked（除非 Cookie/签名健康或 force）。
 */
export function shouldReopenWorkbenchQueueTask(params: {
  queueStatus?: WorkbenchQueueStatus | null
  nextAttemptAt?: Date | null
  errorType?: string | null
  lastError?: string | null
  cache?: WorkbenchCacheSnapshot | null
  order: OrderAfterSaleContext
  force?: boolean
  externalHealth?: QueueExternalHealth
  now?: number
  source?: string
}): WorkbenchReopenDecision {
  const now = params.now ?? Date.now()
  const status = (params.queueStatus ?? '').trim() || 'none'
  const force = params.force === true
  const base = {
    fromStatus: status,
    force,
  }

  if (!status || status === 'none') {
    return { ...base, reopen: true, reason: 'no_queue_row', toStatus: 'pending' }
  }
  if (status === 'pending') {
    return { ...base, reopen: false, reason: 'already_pending', toStatus: 'unchanged' }
  }
  if (status === 'running') {
    return { ...base, reopen: false, reason: 'running_owned_by_timeout_recovery', toStatus: 'unchanged' }
  }

  if (status === 'retry_wait') {
    const nextAt = params.nextAttemptAt?.getTime()
    if (!force && nextAt != null && nextAt > now) {
      return {
        ...base,
        reopen: false,
        reason: `retry_wait_until_${new Date(nextAt).toISOString()}`,
        toStatus: 'unchanged',
      }
    }
    if (force) {
      return {
        ...base,
        reopen: true,
        reason: `force_bypass_retry_wait:${params.source ?? 'unknown'}`,
        toStatus: 'pending',
      }
    }
    return { ...base, reopen: true, reason: 'retry_wait_due', toStatus: 'pending' }
  }

  if (status === 'blocked') {
    const err = (params.errorType ?? '').trim()
    const cookieOk = params.externalHealth?.cookieHealthy === true
    const signOk = params.externalHealth?.signEnvHealthy === true
    const isCookieBlock = /cookie|http_401|http_403/.test(err)
    const isSignBlock = /sign_/.test(err)
    if (force) {
      return {
        ...base,
        reopen: true,
        reason: `force_unblock:${params.source ?? 'unknown'}`,
        toStatus: 'pending',
      }
    }
    if (isCookieBlock && cookieOk) {
      return { ...base, reopen: true, reason: 'cookie_health_restored', toStatus: 'pending' }
    }
    if (isSignBlock && signOk) {
      return { ...base, reopen: true, reason: 'sign_env_restored', toStatus: 'pending' }
    }
    if (!err && cookieOk) {
      return { ...base, reopen: true, reason: 'cookie_health_restored_unknown_err', toStatus: 'pending' }
    }
    return { ...base, reopen: false, reason: `blocked_hold:${err || 'unknown'}`, toStatus: 'unchanged' }
  }

  if (status === 'failed') {
    const err = (params.errorType ?? '').trim()
    if (PERMANENT_FAIL_TYPES.has(err)) {
      if (force) {
        return {
          ...base,
          reopen: true,
          reason: `force_permanent_fail:${err}`,
          toStatus: 'pending',
        }
      }
      return { ...base, reopen: false, reason: `permanent_fail:${err}`, toStatus: 'unchanged' }
    }
    if (force) {
      return { ...base, reopen: true, reason: 'force_failed', toStatus: 'pending' }
    }
    // 临时失败应本属 retry_wait；若落在 failed 仍允许重开以便回到限流队列
    return { ...base, reopen: true, reason: `failed_reopen:${err || 'unknown'}`, toStatus: 'pending' }
  }

  if (status === 'done') {
    const validity = resolveWorkbenchCacheValidity(params.cache, params.order, now)
    if (!validity.valid) {
      return {
        ...base,
        reopen: true,
        reason: validity.staleEmpty
          ? 'stale_empty'
          : validity.staleSuccess
            ? `stale_success:${validity.reason}`
            : `cache_invalid:${validity.reason}`,
        toStatus: 'pending',
      }
    }
    if (force) {
      return {
        ...base,
        reopen: true,
        reason: `force_done_recheck:${params.source ?? 'unknown'}`,
        toStatus: 'pending',
      }
    }
    return { ...base, reopen: false, reason: 'done_cache_valid', toStatus: 'unchanged' }
  }

  const validity = resolveWorkbenchCacheValidity(params.cache, params.order, now)
  if (!validity.valid || force) {
    return {
      ...base,
      reopen: true,
      reason: force ? 'force_unknown_status' : `unknown_status_invalid:${validity.reason}`,
      toStatus: 'pending',
    }
  }
  return { ...base, reopen: false, reason: 'unknown_status_valid', toStatus: 'unchanged' }
}

/** 业务结果指纹（不含 fetchedAt；用于经营缓存失效） */
export function buildWorkbenchBusinessFingerprint(r: {
  fetchStatus?: string | null
  officialRefundAmountCent?: number | null
  freightRefundAmountCent?: number | null
  appliedAmountCent?: number | null
  appliedShipFeeAmountCent?: number | null
  expectedRefundAmountCent?: number | null
  successReturnCount?: number | null
  returnRefundCount?: number | null
  refundOnlyCount?: number | null
  hasReturnRefund?: boolean | null
  hasRefundOnly?: boolean | null
  hasFreightOnlyRefund?: boolean | null
  afterSaleStatus?: string | null
  afterSaleReason?: string | null
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
  returnsIds?: string | string[] | null
  refundIncludesFreight?: boolean | null
}): string {
  const returnsIds = Array.isArray(r.returnsIds)
    ? r.returnsIds.join(',')
    : String(r.returnsIds ?? '')
  return [
    r.fetchStatus ?? '',
    r.officialRefundAmountCent ?? 0,
    r.freightRefundAmountCent ?? 0,
    r.appliedAmountCent ?? 0,
    r.appliedShipFeeAmountCent ?? 0,
    r.expectedRefundAmountCent ?? 0,
    r.successReturnCount ?? 0,
    r.returnRefundCount ?? 0,
    r.refundOnlyCount ?? 0,
    r.hasReturnRefund ? 1 : 0,
    r.hasRefundOnly ? 1 : 0,
    r.hasFreightOnlyRefund ? 1 : 0,
    r.afterSaleStatus ?? '',
    r.afterSaleReason ?? '',
    r.afterSaleType ?? '',
    r.returnTypeCodes ?? '',
    r.classificationSource ?? '',
    returnsIds,
    r.refundIncludesFreight ? 1 : 0,
  ].join('|')
}

export function resolvePreferredWorkbenchRefund(params: {
  current: AfterSalesWorkbenchRefund
  incoming: AfterSalesWorkbenchRefund
  orderContext?: OrderAfterSaleContext
}): { preferred: AfterSalesWorkbenchRefund; reason: string } {
  const { current, incoming, orderContext } = params
  const curT = current.fetchedAt?.getTime() ?? 0
  const inT = incoming.fetchedAt?.getTime() ?? 0

  // 新写入优先（同秒则继续细比）
  if (inT > curT + 500) {
    return { preferred: incoming, reason: 'incoming_newer_fetchedAt' }
  }
  if (curT > inT + 500) {
    // 旧结果更新时间明显更晚，除非新旧状态冲突
    if (incoming.fetchStatus === 'success' && current.fetchStatus === 'empty') {
      return { preferred: incoming, reason: 'prefer_success_over_empty' }
    }
    return { preferred: current, reason: 'current_newer_fetchedAt' }
  }

  const scoreIntegrity = (x: AfterSalesWorkbenchRefund): number => {
    let s = 0
    if (x.fetchStatus === 'success') s += 100
    if (x.fetchStatus === 'empty') s += 10
    if ((x.returnsIds?.length ?? 0) > 0) s += 20 + Math.min(10, x.returnsIds.length)
    if (x.successReturnCount > 0) s += 15
    if (x.rawDetail != null) s += 5
    return s
  }

  // success vs empty：若订单当前无售后信号，允许 empty 覆盖过期 success（平台撤销）
  if (incoming.fetchStatus === 'empty' && current.fetchStatus === 'success' && orderContext) {
    const signal = orderCtxForSignal(orderContext)
    if (
      !orderSignalsCompletedAfterSale(signal) &&
      !hasAfterSaleSignal({ ...signal, raw: orderContext.raw }) &&
      !orderHasInProgressAfterSale(orderContext)
    ) {
      return { preferred: incoming, reason: 'empty_confirmed_no_after_sale_over_success' }
    }
  }
  if (incoming.fetchStatus === 'success' && current.fetchStatus === 'empty') {
    return { preferred: incoming, reason: 'success_over_empty' }
  }

  // returnsIds 并集更大者优先（同时间窗口）
  const curIds = new Set(current.returnsIds ?? [])
  const inIds = new Set(incoming.returnsIds ?? [])
  let incomingHasNew = false
  for (const id of inIds) {
    if (!curIds.has(id)) {
      incomingHasNew = true
      break
    }
  }
  if (incomingHasNew && incoming.fetchStatus === 'success') {
    return { preferred: incoming, reason: 'incoming_has_new_returnsIds' }
  }

  // 分类变化（运费/商品）：优先较新 incoming（时间接近时偏 incoming，因调用方通常先写新）
  const classChanged =
    Boolean(current.hasFreightOnlyRefund) !== Boolean(incoming.hasFreightOnlyRefund) ||
    Boolean(current.hasReturnRefund) !== Boolean(incoming.hasReturnRefund) ||
    Boolean(current.hasRefundOnly) !== Boolean(incoming.hasRefundOnly)
  if (classChanged && inT >= curT) {
    return { preferred: incoming, reason: 'classification_changed_prefer_incoming' }
  }

  const si = scoreIntegrity(incoming)
  const sc = scoreIntegrity(current)
  if (si !== sc) {
    return si > sc
      ? { preferred: incoming, reason: `higher_integrity:${si}>${sc}` }
      : { preferred: current, reason: `higher_integrity:${sc}>${si}` }
  }

  // 金额变化：同等完整性时取更新时间较新；相等则取 incoming（避免旧大额压住修正）
  if (incoming.officialRefundAmountCent !== current.officialRefundAmountCent) {
    if (inT >= curT) return { preferred: incoming, reason: 'amount_changed_prefer_newer' }
    return { preferred: current, reason: 'amount_changed_keep_newer_current' }
  }

  return inT >= curT
    ? { preferred: incoming, reason: 'tie_prefer_incoming' }
    : { preferred: current, reason: 'tie_prefer_current' }
}

/** 从订单 rawJson 抽取售后上下文 */
export function extractOrderAfterSaleContextFromRaw(
  raw: Record<string, unknown> | null | undefined,
  meta?: { orderUpdatedAt?: Date | null; orderTime?: Date | null },
): OrderAfterSaleContext {
  if (!raw || typeof raw !== 'object') {
    return {
      orderStatusText: '',
      afterSaleStatusText: '',
      isReturned: false,
      raw: {},
      orderUpdatedAt: meta?.orderUpdatedAt ?? null,
      orderTime: meta?.orderTime ?? null,
    }
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
  return {
    orderStatusText,
    afterSaleStatusText,
    isReturned,
    raw,
    orderUpdatedAt: meta?.orderUpdatedAt ?? null,
    orderTime: meta?.orderTime ?? null,
  }
}

function pickFrom(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export { BLOCKED_ERROR_TYPES, PERMANENT_FAIL_TYPES }
