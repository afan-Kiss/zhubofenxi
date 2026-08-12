import { prisma } from '../lib/prisma'
import { parseMoneyToCent } from '../utils/money'
import {
  buildLiveAccountOrderQueries,
  liveAccountOrderKey,
  liveAccountPackageKey,
  resolveLiveAccountId,
  type LiveAccountOrderQuery,
} from '../utils/live-account-cache-key.util'
import {
  buildAfterSaleByOrderNo,
  normalizeAfterSaleRecord,
  type AfterSaleOrderAggregate,
  type NormalizedAfterSaleRecord,
} from './xhs-after-sales-range.service'
import { deriveStructuredAfterSaleTypeFromRaw } from './resolve-return-refund-classification.service'
import {
  extractAfterSaleReasonText,
  normalizeAfterSaleRecords,
  isSuccessfulAfterSale,
  stableAfterSaleRecordDedupeKey,
} from './strict-after-sale-metrics.service'
import {
  pickReturnsV3BuyerUserId,
  splitReturnsV3RefundCent,
} from './returns-v3-record.service'
import { AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS } from './after-sales-queue.types'
import { yuanApiAmountToCent } from './business-refund-caliber.service'
import {
  AfterSalesRequestError,
  classifyThrownHttpCause,
  emptyAfterSalesRequestCounters,
  finalizeAfterSalesRequestCounters,
  getAfterSalesRequestAttemptCount,
  getAfterSalesNetworkRequestCount,
  getAfterSalesLocallyThrottledCount,
  type AfterSalesRequestCounters,
} from './after-sales-request-error'
import { getAfterSalesHttpDeps } from './after-sales-http-deps'
import {
  dedupeStatusTexts,
  resolveWorkbenchRecordLifecycle,
} from './workbench-record-lifecycle.service'
import {
  decideAfterSalesPagination,
  parseFiniteNonNegativeInt,
} from './after-sales-pagination.service'
import {
  buildWorkbenchBusinessFingerprint,
  extractOrderAfterSaleContextFromRaw,
  isWorkbenchCacheCurrentlyValid,
  resolvePreferredWorkbenchRefund,
  resolveWorkbenchCacheValidity,
  shouldReopenWorkbenchQueueTask,
  type OrderAfterSaleContext,
  type WorkbenchCacheSnapshot,
} from './workbench-cache-validity.service'
import { logInfo, logWarn } from '../utils/server-log'
import {
  resolveAfterSalesQueueEligibility,
  type ShouldFetchWorkbenchInput,
} from './after-sales-fetch-decision.service'

const WORKBENCH_URL =
  'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3'
const WORKBENCH_REFERER = 'https://ark.xiaohongshu.com/app-order/aftersale/list'

export type WorkbenchFetchStatus = 'pending' | 'success' | 'empty' | 'failed'

export interface AfterSalesWorkbenchRefund {
  liveAccountId?: string
  orderNo: string
  packageId: string | null
  /** 商品退款（不含纯运费退） */
  officialRefundAmountCent: number
  /** 纯运费退款 */
  freightRefundAmountCent: number
  expectedRefundAmountCent: number
  appliedAmountCent: number
  appliedShipFeeAmountCent: number
  payAmountCent: number
  settlementAmountCent: number
  refundIncludesFreight: boolean
  hasFreightOnlyRefund: boolean
  buyerUserId: string | null
  afterSaleReason: string | null
  afterSaleStatus: string | null
  successReturnCount: number
  returnsIds: string[]
  /** 匹配到的售后记录数（含处理中/拒绝/取消/关闭），与 successReturnCount 不同 */
  matchedRecordCount?: number
  processingRecordCount?: number
  completedRecordCount?: number
  rejectedRecordCount?: number
  canceledRecordCount?: number
  closedRecordCount?: number
  unknownRecordCount?: number
  recordLifecycleSummary?: string | null
  hasReturnRefund?: boolean
  hasRefundOnly?: boolean
  returnRefundCount?: number
  refundOnlyCount?: number
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
  fetchStatus: WorkbenchFetchStatus
  fetchError: string | null
  fetchedAt: Date | null
  rawDetail?: unknown
}

/** 售后工作台金额单位为「元」，转为分 */
export { yuanApiAmountToCent } from './business-refund-caliber.service'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function recordMatchesOrderNo(rec: Record<string, unknown>, orderNo: string): boolean {
  const target = orderNo.trim()
  if (!target) return false
  for (const k of [
    'delivery_package_id',
    'package_id',
    'order_id',
    'deliveryPackageId',
    'packageId',
    'orderId',
  ]) {
    const v = rec[k]
    if (v != null && String(v).trim() === target) return true
  }
  return false
}

export function isSuccessfulAfterSaleRecord(rec: Record<string, unknown>): boolean {
  return isSuccessfulAfterSale(rec)
}

export function aggregateWorkbenchRefund(
  afterSales: Record<string, unknown>[],
  orderNo: string,
): Omit<
  AfterSalesWorkbenchRefund,
  'fetchStatus' | 'fetchError' | 'fetchedAt'
> {
  const matched = afterSales.filter((r) => recordMatchesOrderNo(r, orderNo))
  const normalized = normalizeAfterSaleRecords(matched)

  // 所有能确认属于该订单的售后记录（含拒绝/取消/关闭/处理中/未知状态）
  const businessRecords = normalized
  const successRecords: Record<string, unknown>[] = []
  const processingRecords: Record<string, unknown>[] = []
  const rejectedRecords: Record<string, unknown>[] = []
  const canceledRecords: Record<string, unknown>[] = []
  const closedRecords: Record<string, unknown>[] = []
  const unknownRecords: Record<string, unknown>[] = []
  const lifecycleParts: string[] = []

  for (const rec of businessRecords) {
    let life = resolveWorkbenchRecordLifecycle(rec)
    if (life === 'UNKNOWN' && isSuccessfulAfterSaleRecord(rec)) life = 'SUCCESS'
    lifecycleParts.push(life)
    if (life === 'SUCCESS') {
      successRecords.push(rec)
    } else if (life === 'PROCESSING') {
      processingRecords.push(rec)
    } else if (life === 'REJECTED') {
      rejectedRecords.push(rec)
    } else if (life === 'CANCELED') {
      canceledRecords.push(rec)
    } else if (life === 'CLOSED') {
      closedRecords.push(rec)
    } else {
      // UNKNOWN：已匹配真实售后，状态暂不可识别 → 仍计入 matched，不计金额
      unknownRecords.push(rec)
    }
  }

  let officialRefundAmountCent = 0
  let freightRefundAmountCent = 0
  let expectedRefundAmountCent = 0
  let appliedAmountCent = 0
  let appliedShipFeeAmountCent = 0
  let payAmountCent = 0
  let settlementAmountCent = 0
  let hasFreightOnlyRefund = false

  for (const rec of successRecords) {
    const split = splitReturnsV3RefundCent(rec)
    if (split.isFreightOnly) hasFreightOnlyRefund = true
    officialRefundAmountCent += split.productRefundCent
    freightRefundAmountCent += split.freightRefundCent
    expectedRefundAmountCent += yuanApiAmountToCent(
      rec.expected_refund_amount ?? rec.expectedRefundAmount,
    )
    appliedAmountCent += yuanApiAmountToCent(rec.applied_amount ?? rec.appliedAmount)
    appliedShipFeeAmountCent += yuanApiAmountToCent(
      rec.applied_ship_fee_amount ?? rec.appliedShipFeeAmount,
    )
    const pay = yuanApiAmountToCent(rec.pay_amount ?? rec.payAmount)
    const settle = yuanApiAmountToCent(rec.settlement_amount ?? rec.settlementAmount)
    if (pay > payAmountCent) payAmountCent = pay
    if (settle > settlementAmountCent) settlementAmountCent = settle
  }

  const returnsIds: string[] = []
  const reasons: string[] = []
  const statuses: string[] = []
  let buyerUserId: string | null = null
  for (const rec of businessRecords) {
    const rid = pickString(rec, ['returns_id', 'returnsId'])
    if (rid && !returnsIds.includes(rid)) returnsIds.push(rid)
    const uid = pickReturnsV3BuyerUserId(rec)
    if (uid) buyerUserId = uid
    const reason = extractAfterSaleReasonText(rec)
    if (reason) reasons.push(reason)
    const st = pickString(rec, ['refund_status_name', 'status_name', 'statusName'])
    if (st) statuses.push(st)
    if (!isSuccessfulAfterSaleRecord(rec)) {
      const pay = yuanApiAmountToCent(rec.pay_amount ?? rec.payAmount)
      const settle = yuanApiAmountToCent(rec.settlement_amount ?? rec.settlementAmount)
      if (pay > payAmountCent) payAmountCent = pay
      if (settle > settlementAmountCent) settlementAmountCent = settle
    }
  }

  let refundIncludesFreight = appliedShipFeeAmountCent > 0 && officialRefundAmountCent > 0
  if (
    !refundIncludesFreight &&
    payAmountCent > 0 &&
    officialRefundAmountCent > 0 &&
    officialRefundAmountCent >= payAmountCent
  ) {
    refundIncludesFreight = true
  }

  hasFreightOnlyRefund = officialRefundAmountCent === 0 && freightRefundAmountCent > 0

  const structured = deriveStructuredAfterSaleTypeFromRaw(businessRecords)
  const lifeSummary = [...new Set(lifecycleParts)].join(',')

  return {
    orderNo,
    packageId: orderNo,
    officialRefundAmountCent,
    freightRefundAmountCent,
    expectedRefundAmountCent,
    appliedAmountCent,
    appliedShipFeeAmountCent,
    payAmountCent,
    settlementAmountCent,
    refundIncludesFreight,
    hasFreightOnlyRefund,
    buyerUserId,
    afterSaleReason: reasons[0] ?? null,
    afterSaleStatus: dedupeStatusTexts(statuses) || null,
    successReturnCount: successRecords.length,
    matchedRecordCount: businessRecords.length,
    processingRecordCount: processingRecords.length,
    completedRecordCount: successRecords.length,
    rejectedRecordCount: rejectedRecords.length,
    canceledRecordCount: canceledRecords.length,
    closedRecordCount: closedRecords.length,
    unknownRecordCount: unknownRecords.length,
    recordLifecycleSummary: lifeSummary || null,
    returnsIds,
    hasReturnRefund: structured.hasReturnRefund,
    hasRefundOnly: structured.hasRefundOnly,
    returnRefundCount: structured.returnRefundCount,
    refundOnlyCount: structured.refundOnlyCount,
    afterSaleType: structured.afterSaleType,
    returnTypeCodes: structured.returnTypeCodes || null,
    classificationSource: structured.classificationSource,
  }
}

/** 严格对齐 HAR：page/number/keywords/sort/order/status_in=（空），不带 goods_source、return_type_in */
export function buildWorkbenchPageUrl(params: {
  keywords: string
  page?: number
  pageSize?: number
}): string {
  const u = new URL(WORKBENCH_URL)
  u.searchParams.set('page', String(params.page ?? 1))
  u.searchParams.set('number', String(params.pageSize ?? 20))
  u.searchParams.set('keywords', String(params.keywords ?? '').trim())
  u.searchParams.set('sort', 'deadline_for_sort_v1')
  u.searchParams.set('order', 'asc')
  u.searchParams.set('status_in', '')
  return u.toString()
}

function buildWorkbenchQueryKeywords(keywords: string): string {
  return buildWorkbenchPageUrl({ keywords, page: 1, pageSize: 20 })
}

function buildWorkbenchQuery(orderNo: string): string {
  return buildWorkbenchQueryKeywords(orderNo)
}

function emptyWorkbenchResult(
  orderNo: string,
  accountId: string,
  partial: Partial<AfterSalesWorkbenchRefund> & {
    fetchStatus: WorkbenchFetchStatus
    fetchError: string | null
  },
): AfterSalesWorkbenchRefund {
  return {
    orderNo: partial.orderNo ?? orderNo.trim(),
    packageId: partial.packageId ?? null,
    officialRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    expectedRefundAmountCent: 0,
    appliedAmountCent: 0,
    appliedShipFeeAmountCent: 0,
    payAmountCent: 0,
    settlementAmountCent: 0,
    refundIncludesFreight: false,
    hasFreightOnlyRefund: false,
    buyerUserId: null,
    afterSaleReason: null,
    afterSaleStatus: null,
    successReturnCount: 0,
    returnsIds: [],
    fetchedAt: null,
    liveAccountId: accountId,
    ...partial,
  }
}

/** 规范化批量单号：去重、校验 P 前缀；超过上限抛 BATCH_ORDER_LIMIT_EXCEEDED（禁止静默截断） */
export function normalizeWorkbenchBatchOrderNos(orderNos: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of orderNos) {
    if (raw == null || String(raw).trim() === '') {
      throw new Error('EMPTY_ORDER_NO')
    }
    const t = String(raw).trim()
    if (!/^P/i.test(t)) {
      throw new Error(`INVALID_ORDER_NO:${t}`)
    }
    const key = t.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  if (out.length === 0) {
    throw new Error('EMPTY_ORDER_NO')
  }
  if (out.length > AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS) {
    throw new Error(
      `BATCH_ORDER_LIMIT_EXCEEDED: max=${AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS} got=${out.length}`,
    )
  }
  return out
}

/**
 * 解析批量输入：合法单进入 chunks；非法单返回明确错误（不静默丢弃）。
 * 重复单号去重后进入查询，duplicates 列出被折叠的原始下标。
 */
export function partitionWorkbenchOrderNos(orderNos: string[]): {
  chunks: string[][]
  invalid: Array<{ orderNo: string; error: string }>
  duplicates: string[]
} {
  const seen = new Set<string>()
  const normalized: string[] = []
  const invalid: Array<{ orderNo: string; error: string }> = []
  const duplicates: string[] = []
  for (const raw of orderNos) {
    const t = String(raw ?? '').trim()
    if (!t) {
      invalid.push({ orderNo: t, error: 'EMPTY_ORDER_NO' })
      continue
    }
    if (!/^P/i.test(t)) {
      invalid.push({ orderNo: t, error: 'INVALID_ORDER_NO' })
      continue
    }
    const key = t.toUpperCase()
    if (seen.has(key)) {
      duplicates.push(t)
      continue
    }
    seen.add(key)
    normalized.push(t)
  }
  const chunks: string[][] = []
  for (let i = 0; i < normalized.length; i += AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS) {
    chunks.push(normalized.slice(i, i + AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS))
  }
  return { chunks, invalid, duplicates }
}

/** 安全分块：每块最多 10 单；非法单号抛错（不静默丢） */
export function chunkWorkbenchOrderNos(orderNos: string[]): string[][] {
  const { chunks, invalid } = partitionWorkbenchOrderNos(orderNos)
  if (invalid.length > 0) {
    throw new Error(`${invalid[0]!.error}:${invalid[0]!.orderNo || '(empty)'}`)
  }
  return chunks
}

const WORKBENCH_PAGE_HARD_LIMIT = 10

function stableRowDedupeKey(row: Record<string, unknown>): string {
  return stableAfterSaleRecordDedupeKey(row)
}

function pageFingerprint(rows: Record<string, unknown>[]): string {
  return rows.map((r) => stableRowDedupeKey(r)).join('|')
}

async function fetchAfterSalesListByKeywords(
  keywords: string,
  cookie: string,
  liveAccountId?: string,
): Promise<{
  rows: Record<string, unknown>[]
  counters: AfterSalesRequestCounters
  requestAttempts: number
  networkRequests: number
  /** @deprecated 严格等于 networkRequests */
  httpRequests: number
}> {
  const deps = getAfterSalesHttpDeps()
  if (liveAccountId) {
    await deps.waitShopSlot(liveAccountId)
  }

  const all: Record<string, unknown>[] = []
  const seenReturnIds = new Set<string>()
  const seenFingerprints = new Set<string>()
  let page = 1
  const pageSize = 20
  let totalCount: number | null = null
  let requestAttempts = 0
  let networkRequests = 0
  let locallyThrottled = 0
  let rawFetchedCount = 0

  const countersSnapshot = () =>
    finalizeAfterSalesRequestCounters({
      requestAttempts,
      networkRequests,
      locallyThrottled,
    })

  const fail = (
    code: string,
    message: string,
    causeCode: import('./after-sales-request-error').AfterSalesRequestCauseCode,
  ) => {
    const c = countersSnapshot()
    throw new AfterSalesRequestError({
      message: `${code}: ${message}`,
      requestAttempts: c.requestAttempts,
      networkRequests: c.networkRequests,
      locallyThrottled: c.locallyThrottled,
      httpRequests: c.networkRequests,
      page,
      causeCode,
      networkSent: c.networkRequests > 0,
      keywords,
      totalCount,
      fetchedCount: all.length,
      rawFetchedCount,
      uniqueFetchedCount: all.length,
      lastPage: page,
    })
  }

  try {
    for (;;) {
      const url = buildWorkbenchPageUrl({ keywords, page, pageSize })
      requestAttempts++
      let payload: unknown
      try {
        const exec = await deps.httpExecutor({
          url,
          cookie,
          liveAccountId,
          method: 'GET',
          apiName: 'after_sales_workbench',
          urlKey: '/after-sales/workbench',
          referer: WORKBENCH_REFERER,
        })
        if (exec.networkSent) networkRequests++
        if (
          exec.decision === 'local_throttled' ||
          exec.decision === 'local_circuit_open'
        ) {
          locallyThrottled++
        }
        payload = exec.payload
      } catch (e) {
        if (e instanceof AfterSalesRequestError) {
          const net = networkRequests + e.networkRequests
          let local = locallyThrottled + e.locallyThrottled
          if (
            e.locallyThrottled === 0 &&
            (e.causeCode === 'local_throttled' || e.causeCode === 'local_circuit_open')
          ) {
            local += 1
          }
          const attempts = requestAttempts + Math.max(0, e.requestAttempts - 1)
          throw new AfterSalesRequestError({
            message: e.message,
            requestAttempts: attempts,
            networkRequests: net,
            locallyThrottled: local,
            httpRequests: net,
            page,
            causeCode: e.causeCode,
            networkSent: net > 0,
            httpStatus: e.httpStatus,
            keywords,
            totalCount,
            fetchedCount: all.length,
            rawFetchedCount,
            uniqueFetchedCount: all.length,
            lastPage: page,
          })
        }
        // 执行器已调用但未携带 networkSent：按已发网计（非本地拦截路径）
        networkRequests++
        const msg = e instanceof Error ? e.message : String(e)
        const cause = classifyThrownHttpCause(msg)
        throw new AfterSalesRequestError({
          message: msg,
          requestAttempts,
          networkRequests,
          locallyThrottled,
          httpRequests: networkRequests,
          page,
          causeCode: cause,
          networkSent: true,
          keywords,
          totalCount,
          fetchedCount: all.length,
          rawFetchedCount,
          uniqueFetchedCount: all.length,
          lastPage: page,
        })
      }

      const root = asRecord(payload)
      const data = root ? asRecord(root.data) ?? root : null
      if (data) {
        const parsed = parseFiniteNonNegativeInt(
          data.total_count ?? data.totalCount ?? data.total,
        )
        if (parsed != null) {
          totalCount = totalCount == null ? parsed : Math.max(totalCount, parsed)
        }
      }
      const pageRows = extractAfterSalesList(payload)
      rawFetchedCount += pageRows.length
      const fp = pageFingerprint(pageRows)

      const decision = decideAfterSalesPagination({
        page,
        pageSize,
        pageRowsLength: pageRows.length,
        totalCount,
        rawFetchedCount,
        uniqueFetchedCount: all.length + pageRows.filter((r) => {
          const key = stableRowDedupeKey(r)
          return !seenReturnIds.has(key)
        }).length,
        pageHardLimit: WORKBENCH_PAGE_HARD_LIMIT,
        pageFingerprint: fp,
        seenFingerprints,
      })

      if (pageRows.length > 0) seenFingerprints.add(fp)

      for (const row of pageRows) {
        const key = stableRowDedupeKey(row)
        if (seenReturnIds.has(key)) continue
        seenReturnIds.add(key)
        all.push(row)
      }

      if (decision.action === 'fail') {
        fail(decision.code, decision.message, decision.code.toLowerCase().includes('stalled')
          ? 'pagination_stalled'
          : 'pagination_incomplete')
      }
      if (decision.action === 'complete') break

      page++
      if (liveAccountId) {
        await deps.waitShopSlot(liveAccountId)
      }
    }
  } catch (e) {
    if (e instanceof AfterSalesRequestError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    const c = countersSnapshot()
    throw new AfterSalesRequestError({
      message: msg,
      requestAttempts: c.requestAttempts,
      networkRequests: c.networkRequests,
      locallyThrottled: c.locallyThrottled,
      httpRequests: c.networkRequests,
      page,
      causeCode: classifyThrownHttpCause(msg),
      networkSent: c.networkRequests > 0,
      keywords,
      totalCount,
      fetchedCount: all.length,
      rawFetchedCount,
      uniqueFetchedCount: all.length,
      lastPage: page,
    })
  }

  const counters = countersSnapshot()
  return {
    rows: all,
    counters,
    requestAttempts: counters.requestAttempts,
    networkRequests: counters.networkRequests,
    httpRequests: counters.networkRequests,
  }
}

export function extractAfterSalesList(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const data = asRecord(root.data) ?? root
  const list = data.after_sales ?? data.afterSales
  if (!Array.isArray(list)) return []
  return list.map((item) => asRecord(item)).filter((x): x is Record<string, unknown> => x != null)
}

/** 入库用浅层字段：禁止把平台深嵌套整树写入 Prisma Json（会 JSON.stringify 炸栈） */
const RAW_DETAIL_SCALAR_KEYS = [
  'returns_id',
  'returnsId',
  'return_id',
  'delivery_package_id',
  'package_id',
  'packageId',
  'order_id',
  'orderId',
  'status_name',
  'statusName',
  'refund_status_name',
  'refundStatusName',
  'status_desc',
  'statusDesc',
  'status',
  'reason',
  'reason_name_zh',
  'reasonNameZh',
  'reason_code',
  'reasonCode',
  'refund_fee',
  'refundFee',
  'refunded_amount',
  'pay_amount',
  'payAmount',
  'payment_amount',
  'applied_ship_fee_amount',
  'appliedShipFeeAmount',
  'refund_ok_time',
  'refundOkTime',
  'refund_time',
  'refundTime',
  'update_at',
  'updateAt',
  'time',
  'create_time',
  'createTime',
  'refunded',
  'refund_status',
  'refundStatus',
  'return_type',
  'returnType',
  'return_type_name',
  'returnTypeName',
  'refund_only_delivery_status',
  'refundOnlyDeliveryStatus',
] as const

function pickScalarFields(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of RAW_DETAIL_SCALAR_KEYS) {
    if (!(k in rec)) continue
    const v = rec[k]
    if (v == null) continue
    if (typeof v === 'object') continue
    out[k] = v
  }
  return out
}

/** 测试/入库共用：把售后 raw 压成可安全 JSON.stringify 的浅层数组 */
export function sanitizeAfterSaleRawDetailForStorage(raw: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: Record<string, unknown>[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    out.push(pickScalarFields(item as Record<string, unknown>))
  }
  return out.length > 0 ? out : undefined
}

function canJsonSerialize(value: unknown): boolean {
  try {
    JSON.stringify(value)
    return true
  } catch {
    return false
  }
}

/** 从已拉取的 after_sales 列表按单号聚合（无 HTTP） */
export function buildWorkbenchRefundFromList(
  afterSales: Record<string, unknown>[],
  orderNo: string,
  liveAccountId: string,
): AfterSalesWorkbenchRefund {
  const trimmed = orderNo.trim()
  const matched = afterSales.filter((r) => recordMatchesOrderNo(r, trimmed))
  const agg = aggregateWorkbenchRefund(matched, trimmed)
  const validCount = agg.matchedRecordCount ?? 0
  // 有效业务售后记录（含拒绝/取消/关闭/处理中/未知状态）即 success
  const status: WorkbenchFetchStatus = validCount > 0 ? 'success' : 'empty'
  if ((agg.unknownRecordCount ?? 0) > 0) {
    logWarn(
      '售后补查',
      `未知售后状态已保存为真实售后 order=${trimmed} unknown=${agg.unknownRecordCount} status=${agg.afterSaleStatus ?? ''}`,
    )
  }
  return {
    ...agg,
    liveAccountId,
    matchedRecordCount: validCount,
    fetchStatus: status,
    fetchError: null,
    fetchedAt: new Date(),
    rawDetail: sanitizeAfterSaleRawDetailForStorage(matched),
  }
}

/**
 * 单批官方查询：keywords 最多 10 合法 P 单。
 * 超过 10 单请用 fetchAfterSalesWorkbenchByOrderNos（自动分块）或 chunkWorkbenchOrderNos。
 */
export async function fetchAfterSalesWorkbenchByOrderNosWithMeta(
  orderNos: string[],
  liveAccountId?: string,
): Promise<{
  results: Map<string, AfterSalesWorkbenchRefund>
  counters: AfterSalesRequestCounters
  requestAttempts: number
  networkRequests: number
  /** @deprecated 严格等于 networkRequests */
  httpRequests: number
}> {
  const accountId = resolveLiveAccountId(liveAccountId)
  const deps = getAfterSalesHttpDeps()
  const out = new Map<string, AfterSalesWorkbenchRefund>()
  const zero = emptyAfterSalesRequestCounters()

  let normalized: string[]
  try {
    normalized = normalizeWorkbenchBatchOrderNos(orderNos)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(msg)
  }

  if (
    normalized.length > 1 &&
    (!liveAccountId?.trim() || accountId === 'legacy')
  ) {
    const msg = '批量售后查询必须指定订单所属直播号（liveAccountId），订单号须与店铺一致'
    for (const orderNo of normalized) {
      out.set(
        orderNo,
        emptyWorkbenchResult(orderNo, accountId, {
          packageId: orderNo,
          fetchStatus: 'failed',
          fetchError: msg,
        }),
      )
    }
    return {
      results: out,
      counters: zero,
      httpRequests: 0,
      requestAttempts: 0,
      networkRequests: 0,
    }
  }

  let cookie: string
  try {
    cookie = await deps.cookieProvider(accountId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Cookie 未配置'
    for (const orderNo of normalized) {
      out.set(
        orderNo,
        emptyWorkbenchResult(orderNo, accountId, {
          packageId: orderNo,
          fetchStatus: 'failed',
          fetchError: msg.slice(0, 500),
        }),
      )
    }
    return {
      results: out,
      counters: zero,
      httpRequests: 0,
      requestAttempts: 0,
      networkRequests: 0,
    }
  }

  const keywords = normalized.join(',')
  const { rows: afterSales, counters } = await fetchAfterSalesListByKeywords(
    keywords,
    cookie,
    accountId,
  )
  for (const orderNo of normalized) {
    out.set(orderNo, buildWorkbenchRefundFromList(afterSales, orderNo, accountId))
  }
  return {
    results: out,
    counters,
    httpRequests: counters.networkRequests,
    requestAttempts: counters.requestAttempts,
    networkRequests: counters.networkRequests,
  }
}

/**
 * 方案A：超过 10 单自动分块合并；非法单号写入明确失败结果，不静默丢失。
 */
export async function fetchAfterSalesWorkbenchByOrderNos(
  orderNos: string[],
  liveAccountId?: string,
): Promise<Map<string, AfterSalesWorkbenchRefund>> {
  const accountId = resolveLiveAccountId(liveAccountId)
  const out = new Map<string, AfterSalesWorkbenchRefund>()
  const { chunks, invalid } = partitionWorkbenchOrderNos(orderNos)

  for (const bad of invalid) {
    const key = bad.orderNo || `(empty:${bad.error})`
    out.set(
      key,
      emptyWorkbenchResult(bad.orderNo, accountId, {
        packageId: bad.orderNo || null,
        fetchStatus: 'failed',
        fetchError: bad.error,
      }),
    )
  }

  let totalRequestAttempts = 0
  let totalNetworkRequests = 0
  let totalLocallyThrottled = 0
  try {
    for (const chunk of chunks) {
      const {
        results,
        httpRequests,
        requestAttempts,
        networkRequests,
        counters,
      } = await fetchAfterSalesWorkbenchByOrderNosWithMeta(
        chunk,
        liveAccountId,
      )
      totalRequestAttempts += counters?.requestAttempts ?? requestAttempts ?? 0
      totalNetworkRequests +=
        counters?.networkRequests ?? networkRequests ?? httpRequests ?? 0
      totalLocallyThrottled += counters?.locallyThrottled ?? 0
      for (const [k, v] of results) out.set(k, v)
    }
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : '售后工作台查询失败'
    const requestAttempts =
      totalRequestAttempts + getAfterSalesRequestAttemptCount(e)
    const networkRequests =
      totalNetworkRequests + getAfterSalesNetworkRequestCount(e)
    const locallyThrottled =
      totalLocallyThrottled + getAfterSalesLocallyThrottledCount(e)
    const httpRequests = networkRequests
    for (const chunk of chunks) {
      for (const orderNo of chunk) {
        if (out.has(orderNo)) continue
        out.set(
          orderNo,
          emptyWorkbenchResult(orderNo, accountId, {
            packageId: orderNo,
            fetchStatus: 'failed',
            fetchError:
              `${msg} (requestAttempts=${requestAttempts} networkRequests=${networkRequests} locallyThrottled=${locallyThrottled} httpRequests=${httpRequests})`.slice(
                0,
                500,
              ),
          }),
        )
      }
    }
    // 公共 API 返回逐单结果，不静默丢单；上层若需熔断请用 WithMeta
    return out
  }
}

export async function fetchAfterSalesWorkbenchByOrderNo(
  orderNo: string,
  liveAccountId?: string,
  opts?: { fallbackBuyerUserId?: string },
): Promise<AfterSalesWorkbenchRefund> {
  const trimmed = orderNo.trim()
  const accountId = resolveLiveAccountId(liveAccountId)
  if (!trimmed || !/^P/i.test(trimmed)) {
    return emptyWorkbenchResult(trimmed, accountId, {
      packageId: null,
      fetchStatus: 'failed',
      fetchError: '无效订单号（需 P 开头官方订单号）',
    })
  }

  const batch = await fetchAfterSalesWorkbenchByOrderNos([trimmed], accountId)
  let result =
    batch.get(trimmed) ??
    emptyWorkbenchResult(trimmed, accountId, {
      packageId: trimmed,
      fetchStatus: 'failed',
      fetchError: '批量查询未返回该单',
    })

  if (
    result.fetchStatus === 'empty' &&
    opts?.fallbackBuyerUserId?.trim() &&
    opts.fallbackBuyerUserId.trim() !== trimmed
  ) {
    const deps = getAfterSalesHttpDeps()
    let cookie: string
    try {
      cookie = await deps.cookieProvider(accountId)
    } catch (e) {
      return emptyWorkbenchResult(trimmed, accountId, {
        packageId: trimmed,
        fetchStatus: 'failed',
        fetchError: e instanceof Error ? e.message.slice(0, 500) : 'Cookie 未配置',
      })
    }
    try {
      const byBuyer = await fetchAfterSalesListByKeywords(
        opts.fallbackBuyerUserId.trim(),
        cookie,
        accountId,
      )
      const matched = byBuyer.rows.filter((r) => recordMatchesOrderNo(r, trimmed))
      result = buildWorkbenchRefundFromList(matched, trimmed, accountId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '售后工作台查询失败'
      return emptyWorkbenchResult(trimmed, accountId, {
        packageId: trimmed,
        fetchStatus: 'failed',
        fetchError: msg.slice(0, 500),
      })
    }
  }

  return result
}

function rowToRefund(row: {
  liveAccountId: string
  orderNo: string
  packageId: string | null
  officialRefundAmountCent: number
  expectedRefundAmountCent: number | null
  appliedAmountCent: number | null
  appliedShipFeeAmountCent: number
  payAmountCent: number | null
  settlementAmountCent: number | null
  refundIncludesFreight: boolean
  afterSaleReason: string | null
  afterSaleStatus: string | null
  successReturnCount: number
  returnsIds: string | null
  matchedRecordCount?: number | null
  processingRecordCount?: number | null
  completedRecordCount?: number | null
  rejectedRecordCount?: number | null
  canceledRecordCount?: number | null
  closedRecordCount?: number | null
  unknownRecordCount?: number | null
  recordLifecycleSummary?: string | null
  hasReturnRefund?: boolean
  hasRefundOnly?: boolean
  returnRefundCount?: number
  refundOnlyCount?: number
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
  fetchStatus: string
  fetchError: string | null
  fetchedAt: Date | null
  rawDetail?: unknown
}): AfterSalesWorkbenchRefund {
  let freightRefundAmountCent = 0
  let hasFreightOnlyRefund = false
  let buyerUserId: string | null = null
  let countFields = {
    matchedRecordCount: Number(row.matchedRecordCount ?? 0),
    processingRecordCount: Number(row.processingRecordCount ?? 0),
    completedRecordCount: Number(row.completedRecordCount ?? 0),
    rejectedRecordCount: Number(row.rejectedRecordCount ?? 0),
    canceledRecordCount: Number(row.canceledRecordCount ?? 0),
    closedRecordCount: Number(row.closedRecordCount ?? 0),
    unknownRecordCount: Number(row.unknownRecordCount ?? 0),
    recordLifecycleSummary: row.recordLifecycleSummary ?? null,
  }
  let structured = {
    hasReturnRefund: Boolean(row.hasReturnRefund),
    hasRefundOnly: Boolean(row.hasRefundOnly),
    returnRefundCount: Number(row.returnRefundCount ?? 0),
    refundOnlyCount: Number(row.refundOnlyCount ?? 0),
    afterSaleType: row.afterSaleType ?? null,
    returnTypeCodes: row.returnTypeCodes ?? null,
    classificationSource: row.classificationSource ?? null,
  }
  if (row.rawDetail && Array.isArray(row.rawDetail)) {
    const agg = aggregateWorkbenchRefund(row.rawDetail as Record<string, unknown>[], row.orderNo)
    freightRefundAmountCent = agg.freightRefundAmountCent
    hasFreightOnlyRefund = agg.hasFreightOnlyRefund
    buyerUserId = agg.buyerUserId
    // rawDetail 可回填/覆盖结构化分类与数量（历史库无列时从详情重建）
    structured = {
      hasReturnRefund: Boolean(agg.hasReturnRefund),
      hasRefundOnly: Boolean(agg.hasRefundOnly),
      returnRefundCount: Number(agg.returnRefundCount ?? 0),
      refundOnlyCount: Number(agg.refundOnlyCount ?? 0),
      afterSaleType: agg.afterSaleType ?? null,
      returnTypeCodes: agg.returnTypeCodes ?? null,
      classificationSource: agg.classificationSource ?? null,
    }
    if (countFields.matchedRecordCount <= 0 && (agg.matchedRecordCount ?? 0) > 0) {
      countFields = {
        matchedRecordCount: Number(agg.matchedRecordCount ?? 0),
        processingRecordCount: Number(agg.processingRecordCount ?? 0),
        completedRecordCount: Number(agg.completedRecordCount ?? 0),
        rejectedRecordCount: Number(agg.rejectedRecordCount ?? 0),
        canceledRecordCount: Number(agg.canceledRecordCount ?? 0),
        closedRecordCount: Number(agg.closedRecordCount ?? 0),
        unknownRecordCount: Number(agg.unknownRecordCount ?? 0),
        recordLifecycleSummary: agg.recordLifecycleSummary ?? null,
      }
    }
  }
  return {
    liveAccountId: resolveLiveAccountId(row.liveAccountId),
    orderNo: row.orderNo,
    packageId: row.packageId,
    officialRefundAmountCent: row.officialRefundAmountCent,
    freightRefundAmountCent,
    expectedRefundAmountCent: row.expectedRefundAmountCent ?? 0,
    appliedAmountCent: row.appliedAmountCent ?? 0,
    appliedShipFeeAmountCent: row.appliedShipFeeAmountCent,
    payAmountCent: row.payAmountCent ?? 0,
    settlementAmountCent: row.settlementAmountCent ?? 0,
    refundIncludesFreight: row.refundIncludesFreight,
    hasFreightOnlyRefund,
    buyerUserId,
    afterSaleReason: row.afterSaleReason,
    afterSaleStatus: row.afterSaleStatus,
    successReturnCount: row.successReturnCount,
    returnsIds: row.returnsIds ? row.returnsIds.split(',').filter(Boolean) : [],
    ...countFields,
    ...structured,
    fetchStatus: row.fetchStatus as WorkbenchFetchStatus,
    fetchError: row.fetchError,
    fetchedAt: row.fetchedAt,
    rawDetail: row.rawDetail ?? undefined,
  }
}

let memoryCache = new Map<string, AfterSalesWorkbenchRefund>()
let memoryCacheAt = 0

export async function refreshWorkbenchMemoryCache(): Promise<number> {
  const rows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: { fetchStatus: { in: ['success', 'empty'] } },
  })
  const next = new Map<string, AfterSalesWorkbenchRefund>()
  for (const row of rows) {
    const refund = rowToRefund(row)
    // 内存缓存仅用于退款聚合字段，不保留 rawDetail，避免全量加载时 OOM
    refund.rawDetail = undefined
    next.set(liveAccountOrderKey(row.liveAccountId, row.orderNo), refund)
  }
  memoryCache = next
  memoryCacheAt = Date.now()
  return next.size
}

export function getWorkbenchRefundFromMemory(
  liveAccountId: string | undefined | null,
  orderNo: string,
): AfterSalesWorkbenchRefund | undefined {
  return memoryCache.get(liveAccountOrderKey(liveAccountId, orderNo))
}

export function mergeWorkbenchIntoMemory(
  liveAccountId: string | undefined | null,
  orderNo: string,
  refund: AfterSalesWorkbenchRefund,
): void {
  memoryCache.set(liveAccountOrderKey(liveAccountId, orderNo), refund)
}

export function getWorkbenchRefundMapForOrders(
  queries: LiveAccountOrderQuery[],
): Map<string, AfterSalesWorkbenchRefund> {
  const m = new Map<string, AfterSalesWorkbenchRefund>()
  for (const q of queries) {
    const key = liveAccountOrderKey(q.liveAccountId, q.orderNo)
    const hit = memoryCache.get(key)
    if (hit) m.set(key, hit)
  }
  return m
}

/** 合并 DB / 内存售后缓存：优先更新时间与完整性，金额越大不胜出 */
export function pickPreferredWorkbenchRefund(
  a: AfterSalesWorkbenchRefund,
  b: AfterSalesWorkbenchRefund,
  orderContext?: OrderAfterSaleContext,
): AfterSalesWorkbenchRefund {
  const aT = a.fetchedAt?.getTime() ?? 0
  const bT = b.fetchedAt?.getTime() ?? 0
  const incoming = aT >= bT ? a : b
  const current = aT >= bT ? b : a
  return resolvePreferredWorkbenchRefund({ current, incoming, orderContext }).preferred
}

export function mergeWorkbenchRefundMaps(
  ...maps: Array<Map<string, AfterSalesWorkbenchRefund>>
): Map<string, AfterSalesWorkbenchRefund> {
  const merged = new Map<string, AfterSalesWorkbenchRefund>()
  for (const map of maps) {
    for (const [k, v] of map) {
      const cur = merged.get(k)
      merged.set(k, cur ? pickPreferredWorkbenchRefund(v, cur) : v)
    }
  }
  return merged
}

/** 售后工作台缓存是否有晚于某时刻的更新（用于经营看板缓存失效） */
export async function getLatestWorkbenchCacheUpdatedAt(): Promise<Date | null> {
  const row = await prisma.xhsAfterSalesWorkbenchCache.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })
  return row?.updatedAt ?? null
}

export async function getLatestTimeSearchCacheUpdatedAt(): Promise<Date | null> {
  const row = await prisma.xhsAfterSalesTimeSearchCache.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })
  return row?.updatedAt ?? null
}

function workbenchRefundFingerprint(r: {
  fetchStatus?: string | null
  officialRefundAmountCent?: number | null
  freightRefundAmountCent?: number | null
  appliedAmountCent?: number | null
  appliedShipFeeAmountCent?: number | null
  expectedRefundAmountCent?: number | null
  successReturnCount?: number | null
  matchedRecordCount?: number | null
  processingRecordCount?: number | null
  completedRecordCount?: number | null
  rejectedRecordCount?: number | null
  canceledRecordCount?: number | null
  closedRecordCount?: number | null
  unknownRecordCount?: number | null
  recordLifecycleSummary?: string | null
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
  return buildWorkbenchBusinessFingerprint({
    ...r,
    freightRefundAmountCent: r.freightRefundAmountCent ?? r.appliedShipFeeAmountCent,
    hasFreightOnlyRefund:
      r.hasFreightOnlyRefund ??
      ((r.freightRefundAmountCent ?? r.appliedShipFeeAmountCent ?? 0) > 0 &&
        (r.officialRefundAmountCent ?? 0) === 0),
  })
}

export async function saveWorkbenchCache(
  result: AfterSalesWorkbenchRefund & { rawDetail?: unknown },
  liveAccountId?: string,
): Promise<void> {
  const accountId = resolveLiveAccountId(liveAccountId ?? result.liveAccountId)
  const prev = await prisma.xhsAfterSalesWorkbenchCache.findUnique({
    where: {
      liveAccountId_orderNo: {
        liveAccountId: accountId,
        orderNo: result.orderNo,
      },
    },
    select: {
      fetchStatus: true,
      officialRefundAmountCent: true,
      expectedRefundAmountCent: true,
      appliedAmountCent: true,
      appliedShipFeeAmountCent: true,
      successReturnCount: true,
      matchedRecordCount: true,
      processingRecordCount: true,
      completedRecordCount: true,
      rejectedRecordCount: true,
      canceledRecordCount: true,
      closedRecordCount: true,
      unknownRecordCount: true,
      recordLifecycleSummary: true,
      returnRefundCount: true,
      refundOnlyCount: true,
      hasReturnRefund: true,
      hasRefundOnly: true,
      afterSaleStatus: true,
      afterSaleReason: true,
      afterSaleType: true,
      returnTypeCodes: true,
      classificationSource: true,
      returnsIds: true,
      refundIncludesFreight: true,
      // 故意不读历史 rawDetail：旧库可能有深嵌套，Prisma 反序列化也会炸栈
    },
  })

  const countCreate = {
    matchedRecordCount: Number(result.matchedRecordCount ?? 0),
    processingRecordCount: Number(result.processingRecordCount ?? 0),
    completedRecordCount: Number(result.completedRecordCount ?? 0),
    rejectedRecordCount: Number(result.rejectedRecordCount ?? 0),
    canceledRecordCount: Number(result.canceledRecordCount ?? 0),
    closedRecordCount: Number(result.closedRecordCount ?? 0),
    unknownRecordCount: Number(result.unknownRecordCount ?? 0),
    recordLifecycleSummary: result.recordLifecycleSummary ?? null,
  }

  const sanitizedRaw = sanitizeAfterSaleRawDetailForStorage(result.rawDetail)
  const rawDetailForDb =
    sanitizedRaw && canJsonSerialize(sanitizedRaw)
      ? (sanitizedRaw as unknown as object)
      : undefined

  await prisma.xhsAfterSalesWorkbenchCache.upsert({
    where: {
      liveAccountId_orderNo: {
        liveAccountId: accountId,
        orderNo: result.orderNo,
      },
    },
    create: {
      liveAccountId: accountId,
      orderNo: result.orderNo,
      packageId: result.packageId,
      officialRefundAmountCent: result.officialRefundAmountCent,
      expectedRefundAmountCent: result.expectedRefundAmountCent || null,
      appliedAmountCent: result.appliedAmountCent || null,
      appliedShipFeeAmountCent: result.appliedShipFeeAmountCent,
      payAmountCent: result.payAmountCent || null,
      settlementAmountCent: result.settlementAmountCent || null,
      refundIncludesFreight: result.refundIncludesFreight,
      afterSaleReason: result.afterSaleReason,
      afterSaleStatus: result.afterSaleStatus,
      successReturnCount: result.successReturnCount,
      returnsIds: result.returnsIds.join(',') || null,
      rawDetail: rawDetailForDb,
      ...countCreate,
      hasReturnRefund: Boolean(result.hasReturnRefund),
      hasRefundOnly: Boolean(result.hasRefundOnly),
      returnRefundCount: Number(result.returnRefundCount ?? 0),
      refundOnlyCount: Number(result.refundOnlyCount ?? 0),
      afterSaleType: result.afterSaleType ?? null,
      returnTypeCodes: result.returnTypeCodes ?? null,
      classificationSource: result.classificationSource ?? null,
      fetchStatus: result.fetchStatus,
      fetchError: result.fetchError,
      fetchedAt: result.fetchedAt,
    },
    update: {
      liveAccountId: accountId,
      packageId: result.packageId,
      officialRefundAmountCent: result.officialRefundAmountCent,
      expectedRefundAmountCent: result.expectedRefundAmountCent || null,
      appliedAmountCent: result.appliedAmountCent || null,
      appliedShipFeeAmountCent: result.appliedShipFeeAmountCent,
      payAmountCent: result.payAmountCent || null,
      settlementAmountCent: result.settlementAmountCent || null,
      refundIncludesFreight: result.refundIncludesFreight,
      afterSaleReason: result.afterSaleReason,
      afterSaleStatus: result.afterSaleStatus,
      successReturnCount: result.successReturnCount,
      returnsIds: result.returnsIds.join(',') || null,
      rawDetail: rawDetailForDb,
      ...countCreate,
      hasReturnRefund: Boolean(result.hasReturnRefund),
      hasRefundOnly: Boolean(result.hasRefundOnly),
      returnRefundCount: Number(result.returnRefundCount ?? 0),
      refundOnlyCount: Number(result.refundOnlyCount ?? 0),
      afterSaleType: result.afterSaleType ?? null,
      returnTypeCodes: result.returnTypeCodes ?? null,
      classificationSource: result.classificationSource ?? null,
      fetchStatus: result.fetchStatus,
      fetchError: result.fetchError,
      fetchedAt: result.fetchedAt,
    },
  })
  if (result.fetchStatus === 'success' || result.fetchStatus === 'empty') {
    const key = liveAccountOrderKey(accountId, result.orderNo)
    const memPrev = memoryCache.get(key)
    memoryCache.set(
      key,
      memPrev ? pickPreferredWorkbenchRefund({ ...result, liveAccountId: accountId }, memPrev) : {
        ...result,
        liveAccountId: accountId,
      },
    )
  }

  const nextFp = workbenchRefundFingerprint({
    ...result,
    returnsIds: result.returnsIds,
    freightRefundAmountCent: result.freightRefundAmountCent,
    hasFreightOnlyRefund: result.hasFreightOnlyRefund,
  })
  const prevFp = prev
    ? workbenchRefundFingerprint({
        ...prev,
        freightRefundAmountCent: prev.appliedShipFeeAmountCent,
        hasFreightOnlyRefund:
          (prev.appliedShipFeeAmountCent ?? 0) > 0 && (prev.officialRefundAmountCent ?? 0) === 0,
      })
    : ''
  const emptyToSuccess = prev?.fetchStatus === 'empty' && result.fetchStatus === 'success'
  // 业务指纹变化 → 按订单支付日合并失效（禁止每笔全量清空）
  if (!prev || prevFp !== nextFp || emptyToSuccess) {
    try {
      const orderRow = await prisma.xhsRawOrder.findFirst({
        where: {
          liveAccountId: accountId,
          OR: [{ packageId: result.orderNo }, { orderId: result.orderNo }],
        },
        select: { orderTime: true, rawJson: true },
        orderBy: { updatedAt: 'desc' },
      })
      let payTime: Date | null = orderRow?.orderTime ?? null
      const raw = orderRow?.rawJson as Record<string, unknown> | undefined
      if (raw) {
        const t = String(
          raw.payTime ?? raw.paidAt ?? raw.paymentTime ?? raw.pay_time ?? '',
        ).trim()
        if (t) {
          const d = new Date(t.replace(' ', 'T'))
          if (!Number.isNaN(d.getTime())) payTime = d
        }
      }
      const { scheduleBusinessBoardCacheInvalidationForPayTime } = await import(
        './business-cache-range-invalidation.service'
      )
      scheduleBusinessBoardCacheInvalidationForPayTime(payTime, result.orderNo)
    } catch {
      // ignore
    }
  }
}

export async function enqueueWorkbenchSync(
  orderNo: string,
  liveAccountId?: string,
  opts?: { force?: boolean; source?: string },
): Promise<{ reopened: boolean; reason: string; priority?: number }> {
  const trimmed = orderNo.trim()
  const accountId = resolveLiveAccountId(liveAccountId)
  if (!trimmed || !/^P/i.test(trimmed)) return { reopened: false, reason: 'invalid_order_no' }

  const { loadOrderAfterSaleContext, getShopExternalHealth } = await import(
    './after-sales-queue.service'
  )
  const { writeAfterSalesQueueAudit } = await import('./after-sales-queue-audit.service')
  const { loadAllQualityBadCases, getOfficialQualityPackageIdSet } = await import(
    './quality-badcase-store.service'
  )

  const [existingQueue, cacheRow, orderCtx, externalHealth, qualityCases] = await Promise.all([
    prisma.xhsAfterSalesWorkbenchQueue.findUnique({
      where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
      select: {
        status: true,
        nextAttemptAt: true,
        errorType: true,
        lastError: true,
        priority: true,
        triggerReason: true,
        signalDetectedAt: true,
      },
    }),
    prisma.xhsAfterSalesWorkbenchCache.findUnique({
      where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
      select: {
        fetchStatus: true,
        fetchedAt: true,
        updatedAt: true,
        officialRefundAmountCent: true,
        expectedRefundAmountCent: true,
        appliedAmountCent: true,
        appliedShipFeeAmountCent: true,
        successReturnCount: true,
        returnRefundCount: true,
        refundOnlyCount: true,
        hasReturnRefund: true,
        hasRefundOnly: true,
        afterSaleStatus: true,
        afterSaleReason: true,
        afterSaleType: true,
        returnTypeCodes: true,
        classificationSource: true,
        returnsIds: true,
        refundIncludesFreight: true,
      },
    }),
    loadOrderAfterSaleContext(accountId, trimmed),
    getShopExternalHealth(accountId),
    loadAllQualityBadCases(),
  ])

  const orderContext = orderCtx ?? extractOrderAfterSaleContextFromRaw({})
  const cacheSnapshot: WorkbenchCacheSnapshot | null = cacheRow
    ? {
        fetchStatus: cacheRow.fetchStatus,
        fetchedAt: cacheRow.fetchedAt,
        updatedAt: cacheRow.updatedAt,
        officialRefundAmountCent: cacheRow.officialRefundAmountCent,
        expectedRefundAmountCent: cacheRow.expectedRefundAmountCent,
        appliedAmountCent: cacheRow.appliedAmountCent,
        appliedShipFeeAmountCent: cacheRow.appliedShipFeeAmountCent,
        freightRefundAmountCent: cacheRow.appliedShipFeeAmountCent,
        successReturnCount: cacheRow.successReturnCount,
        returnRefundCount: cacheRow.returnRefundCount,
        refundOnlyCount: cacheRow.refundOnlyCount,
        hasReturnRefund: cacheRow.hasReturnRefund,
        hasRefundOnly: cacheRow.hasRefundOnly,
        afterSaleStatus: cacheRow.afterSaleStatus,
        afterSaleReason: cacheRow.afterSaleReason,
        afterSaleType: cacheRow.afterSaleType,
        returnTypeCodes: cacheRow.returnTypeCodes,
        classificationSource: cacheRow.classificationSource,
        returnsIds: cacheRow.returnsIds,
        refundIncludesFreight: cacheRow.refundIncludesFreight,
      }
    : null

  const cacheValidity = resolveWorkbenchCacheValidity(cacheSnapshot, orderContext)
  const cacheCurrentlyValid = isWorkbenchCacheCurrentlyValid(cacheSnapshot, orderContext)
  const officialSet = getOfficialQualityPackageIdSet(qualityCases)
  const officialQualityCaseMatched = officialSet.has(
    liveAccountPackageKey(accountId, trimmed),
  )

  const fetchInput: ShouldFetchWorkbenchInput = {
    orderStatusText: orderContext.orderStatusText ?? undefined,
    afterSaleStatusText: orderContext.afterSaleStatusText ?? undefined,
    isReturned: orderContext.isReturned === true,
    raw: undefined,
    displayOrderNo: trimmed,
    officialOrderNo: trimmed,
    liveAccountId: accountId,
    cacheFetchStatus: cacheRow?.fetchStatus ?? null,
  }
  // 带上订单 raw，供 ID/金额语义判定
  try {
    const rawRow = await prisma.xhsRawOrder.findFirst({
      where: {
        liveAccountId: accountId,
        OR: [{ packageId: trimmed }, { orderId: trimmed }, { displayOrderNo: trimmed }],
      },
      select: { rawJson: true, isReturned: true, afterSaleStatusText: true, orderStatusText: true },
      orderBy: { updatedAt: 'desc' },
    })
    if (rawRow?.rawJson && typeof rawRow.rawJson === 'object') {
      fetchInput.raw = rawRow.rawJson as Record<string, unknown>
    }
    if (rawRow?.afterSaleStatusText) fetchInput.afterSaleStatusText = rawRow.afterSaleStatusText
    if (rawRow?.orderStatusText) fetchInput.orderStatusText = rawRow.orderStatusText
    if (rawRow?.isReturned != null) fetchInput.isReturned = Boolean(rawRow.isReturned)
  } catch {
    // ignore
  }

  const eligibility = resolveAfterSalesQueueEligibility(fetchInput, {
    officialQualityCaseMatched,
    cacheMissingOrStale: !cacheRow || !cacheValidity.valid,
    cacheCurrentlyValid,
  })

  const force = opts?.force === true
  if (!existingQueue && !eligibility.eligible && !force) {
    return { reopened: false, reason: eligibility.reason, priority: 0 }
  }

  const prevPriority = existingQueue?.priority ?? 0
  const nextPriority = Math.max(prevPriority, eligibility.priority, force ? 40 : 0)
  const higherSignal =
    eligibility.eligible && eligibility.priority > prevPriority && eligibility.priority >= 75

  const decision = shouldReopenWorkbenchQueueTask({
    queueStatus: existingQueue?.status,
    nextAttemptAt: existingQueue?.nextAttemptAt,
    errorType: existingQueue?.errorType,
    lastError: existingQueue?.lastError,
    cache: cacheSnapshot,
    order: orderContext,
    force: force || higherSignal,
    source: opts?.source ?? 'enqueueWorkbenchSync',
    externalHealth,
  })

  if (!existingQueue) {
    if (!eligibility.eligible && !force) {
      return { reopened: false, reason: eligibility.reason, priority: 0 }
    }
    const now = new Date()
    await prisma.xhsAfterSalesWorkbenchQueue.create({
      data: {
        liveAccountId: accountId,
        orderNo: trimmed,
        status: 'pending',
        statusChangedAt: now,
        priority: nextPriority,
        triggerReason: eligibility.reason || (force ? 'force_create' : 'created'),
        signalDetectedAt: eligibility.eligible ? now : null,
      },
    })
    await writeAfterSalesQueueAudit({
      liveAccountId: accountId,
      orderNo: trimmed,
      fromStatus: null,
      toStatus: 'pending',
      reason: eligibility.reason || 'created',
      source: opts?.source ?? 'enqueueWorkbenchSync',
      cacheStatus: cacheRow?.fetchStatus,
      orderAfterSaleStatus: orderContext.afterSaleStatusText,
      force,
      operator: force ? 'admin_force' : null,
    })
    logInfo(
      '售后补查',
      `入队 create pending shop=${accountId} order=${trimmed} priority=${nextPriority} reason=${eligibility.reason} source=${opts?.source ?? 'enqueue'}`,
    )
    return { reopened: true, reason: 'created', priority: nextPriority }
  }

  // 已有队列：更新 priority / triggerReason；无资格且非 force 则不重开
  if (!eligibility.eligible && !force) {
    if (nextPriority !== prevPriority) {
      await prisma.xhsAfterSalesWorkbenchQueue.update({
        where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
        data: { priority: nextPriority },
      })
    }
    return { reopened: false, reason: eligibility.reason || decision.reason, priority: nextPriority }
  }

  if (!decision.reopen) {
    // 仍更新优先级元数据
    const nowMeta = new Date()
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
      data: {
        priority: nextPriority,
        triggerReason: eligibility.reason || existingQueue.triggerReason,
        signalDetectedAt: existingQueue.signalDetectedAt ?? (eligibility.eligible ? nowMeta : null),
      },
    })
    return { reopened: false, reason: decision.reason, priority: nextPriority }
  }

  if (decision.force || force) {
    logWarn(
      '售后补查',
      `FORCE/高信号重开 ${decision.fromStatus}→pending shop=${accountId} order=${trimmed} reason=${decision.reason} eligibility=${eligibility.reason} priority=${nextPriority}`,
    )
  } else {
    logInfo(
      '售后补查',
      `重开 ${decision.fromStatus}→pending shop=${accountId} order=${trimmed} reason=${decision.reason} priority=${nextPriority}`,
    )
  }

  const now = new Date()
  await prisma.xhsAfterSalesWorkbenchQueue.update({
    where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
    data: {
      status: 'pending',
      completedAt: null,
      runningSince: null,
      lastError: null,
      errorType: null,
      nextAttemptAt: null,
      workerId: null,
      claimToken: null,
      claimedAt: null,
      statusChangedAt: now,
      // 重开必须清零临时重试计数，否则 attempt_cap 后立刻再次触顶，永远修不好
      temporaryAttemptCount: 0,
      priority: nextPriority,
      triggerReason: eligibility.reason || decision.reason,
      signalDetectedAt: existingQueue.signalDetectedAt ?? now,
    },
  })
  await writeAfterSalesQueueAudit({
    liveAccountId: accountId,
    orderNo: trimmed,
    fromStatus: decision.fromStatus,
    toStatus: 'pending',
    reason: eligibility.reason || decision.reason,
    force: decision.force || force,
    source: opts?.source ?? 'enqueueWorkbenchSync',
    cacheStatus: cacheRow?.fetchStatus,
    orderAfterSaleStatus: orderContext.afterSaleStatusText,
    operator: force || decision.force ? 'admin_force' : null,
  })
  return { reopened: true, reason: decision.reason, priority: nextPriority }
}

/** @deprecated 请使用 shouldFetchAfterSalesWorkbench */
export function orderNeedsWorkbenchSync(order: {
  orderStatusText?: string
  afterSaleStatusText?: string
  isReturned?: boolean
  displayOrderNo?: string
  officialOrderNo?: string
  raw?: Record<string, unknown>
}): boolean {
  const text = [order.orderStatusText, order.afterSaleStatusText].filter(Boolean).join(' ')
  if (order.isReturned) return true
  return /退款|退货|售后|已关闭|其他售后/.test(text)
}

export function pickBuyerUserIdFromRawJson(
  raw: Record<string, unknown> | undefined,
  buyerId?: string | null,
): string | undefined {
  if (!raw) return buyerId?.trim() || undefined
  const fromMeta = raw._buyerOfficialId != null ? String(raw._buyerOfficialId).trim() : ''
  if (fromMeta) return fromMeta
  for (const k of ['user_id', 'userId', 'buyer_id', 'buyerId']) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  const userInfo = raw.userInfo
  if (userInfo && typeof userInfo === 'object') {
    for (const k of ['userId', 'user_id', 'buyerId', 'buyer_id']) {
      const v = (userInfo as Record<string, unknown>)[k]
      if (v != null && String(v).trim()) return String(v).trim()
    }
  }
  const id = buyerId?.trim()
  if (id && !id.startsWith('nick:')) return id
  return undefined
}

export async function syncWorkbenchForOrderNo(
  orderNo: string,
  liveAccountId?: string,
  opts?: { fallbackBuyerUserId?: string; queueId?: string },
): Promise<AfterSalesWorkbenchRefund> {
  const accountId = resolveLiveAccountId(liveAccountId)
  const result = await fetchAfterSalesWorkbenchByOrderNo(orderNo, accountId, opts)
  if (result.fetchStatus !== 'failed') {
    await saveWorkbenchCache(result, accountId)
  }
  if (opts?.queueId) {
    const { completeAfterSalesQueueTask } = await import('./after-sales-queue.service')
    await completeAfterSalesQueueTask({
      queueId: opts.queueId,
      liveAccountId: accountId,
      orderNo: orderNo.trim(),
      result,
    })
  } else {
    const { completeAfterSalesQueueTask } = await import('./after-sales-queue.service')
    const row = await prisma.xhsAfterSalesWorkbenchQueue.findFirst({
      where: { liveAccountId: accountId, orderNo: orderNo.trim() },
      select: { id: true },
    })
    if (row) {
      await completeAfterSalesQueueTask({
        queueId: row.id,
        liveAccountId: accountId,
        orderNo: orderNo.trim(),
        result,
      })
    }
  }
  return result
}

/**
 * 唯一售后 worker 批入口：走 select/claim/限流，禁止直接 findMany pending
 */
export async function processWorkbenchQueueBatch(limit = 10): Promise<{
  processed: number
  selected: number
  succeeded: number
  emptied: number
  retryWait: number
  blocked: number
  failed: number
  skipped: number
  errors: string[]
  metrics?: import('./after-sales-backfill.service').AfterSalesBatchMetrics
}> {
  const { runAfterSalesBackfillBatch } = await import('./after-sales-backfill.service')
  const { DEFAULT_AFTER_SALES_QUEUE_LIMITS } = await import('./after-sales-queue.types')
  // limit 语义：本批最多订单数；店铺上限保持默认
  const globalPerMinute = Math.max(1, Math.min(limit, DEFAULT_AFTER_SALES_QUEUE_LIMITS.globalPerMinute))
  const result = await runAfterSalesBackfillBatch({
    ...DEFAULT_AFTER_SALES_QUEUE_LIMITS,
    globalPerMinute,
  })
  return {
    processed: result.processed,
    selected: result.claimed,
    succeeded: result.detailsSaved + result.processingDetailsSaved,
    emptied: result.noAfterSale,
    retryWait: result.retryWait,
    blocked: result.blocked,
    failed: result.failed,
    skipped: result.skippedBecauseRunning ? 1 : 0,
    errors: [],
    metrics: result,
  }
}

export type WorkbenchRefundLoadResult = AfterSalesWorkbenchRefund & {
  refundDataStatus?: 'trusted' | 'stale' | 'pending' | 'unknown'
  refundDataFetchedAt?: string | null
  refundDataSource?: 'workbench_cache' | 'memory'
  refundDataStaleReason?: string | null
}

export async function loadWorkbenchRefundMapFromDb(
  queries: LiveAccountOrderQuery[],
): Promise<Map<string, WorkbenchRefundLoadResult>> {
  if (queries.length === 0) return new Map()
  const unique = new Map<string, LiveAccountOrderQuery>()
  for (const q of queries) {
    unique.set(liveAccountOrderKey(q.liveAccountId, q.orderNo), q)
  }
  const { loadOrderAfterSaleContext } = await import('./after-sales-queue.service')
  const { resolveWorkbenchCacheValidity } = await import('./workbench-cache-validity.service')

  const rows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: {
      OR: [...unique.values()].map((q) => ({
        liveAccountId: resolveLiveAccountId(q.liveAccountId),
        orderNo: q.orderNo.trim(),
      })),
      fetchStatus: { in: ['success', 'empty'] },
    },
  })
  const m = new Map<string, WorkbenchRefundLoadResult>()
  for (const row of rows) {
    const key = liveAccountOrderKey(row.liveAccountId, row.orderNo)
    const orderCtx = await loadOrderAfterSaleContext(row.liveAccountId, row.orderNo)
    const validity = resolveWorkbenchCacheValidity(
      {
        fetchStatus: row.fetchStatus,
        fetchedAt: row.fetchedAt,
        updatedAt: row.updatedAt,
        officialRefundAmountCent: row.officialRefundAmountCent,
        freightRefundAmountCent: row.appliedShipFeeAmountCent,
        expectedRefundAmountCent: row.expectedRefundAmountCent,
        appliedAmountCent: row.appliedAmountCent,
        appliedShipFeeAmountCent: row.appliedShipFeeAmountCent,
        successReturnCount: row.successReturnCount,
        returnRefundCount: row.returnRefundCount,
        refundOnlyCount: row.refundOnlyCount,
        hasReturnRefund: row.hasReturnRefund,
        hasRefundOnly: row.hasRefundOnly,
        afterSaleStatus: row.afterSaleStatus,
        afterSaleReason: row.afterSaleReason,
        afterSaleType: row.afterSaleType,
        returnTypeCodes: row.returnTypeCodes,
        classificationSource: row.classificationSource,
        returnsIds: row.returnsIds,
        refundIncludesFreight: row.refundIncludesFreight,
      },
      orderCtx,
    )
    // stale 可暂展示但标记；不可信空结果不得冒充 0 退款正式关账
    if (!validity.valid && row.fetchStatus === 'empty') continue
    const base = rowToRefund(row)
    m.set(key, {
      ...base,
      refundDataStatus: validity.valid ? 'trusted' : 'stale',
      refundDataFetchedAt: row.fetchedAt?.toISOString() ?? null,
      refundDataSource: 'workbench_cache',
      refundDataStaleReason: validity.valid ? null : validity.reason,
    })
  }
  for (const [key, q] of unique) {
    if (!m.has(key)) {
      const mem = memoryCache.get(key)
      if (mem) {
        m.set(key, {
          ...mem,
          refundDataStatus: 'trusted',
          refundDataFetchedAt: mem.fetchedAt?.toISOString?.() ?? null,
          refundDataSource: 'memory',
          refundDataStaleReason: null,
        })
      }
    }
  }
  return m
}

export async function bootstrapWorkbenchCache(): Promise<void> {
  if (memoryCache.size > 0 && Date.now() - memoryCacheAt < 60_000) return
  await refreshWorkbenchMemoryCache()
}

/** 从 DB 售后缓存加载售后聚合；优先 rawDetail，缺失时用结构化分类字段 */
export async function loadAfterSalesBundleForOrderNos(
  queries: LiveAccountOrderQuery[],
  paidOrderNos?: Set<string>,
): Promise<{
  rawAfterSalesByOrderNo: Map<string, Record<string, unknown>[]>
  afterSaleByOrderNo: Map<string, AfterSaleOrderAggregate>
}> {
  const rawAfterSalesByOrderNo = new Map<string, Record<string, unknown>[]>()
  const afterSaleByOrderNo = new Map<string, AfterSaleOrderAggregate>()

  if (queries.length === 0) {
    return { rawAfterSalesByOrderNo, afterSaleByOrderNo }
  }

  const unique = new Map<string, LiveAccountOrderQuery>()
  for (const q of queries) {
    unique.set(liveAccountOrderKey(q.liveAccountId, q.orderNo), q)
  }

  const rows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: {
      OR: [...unique.values()].map((q) => ({
        liveAccountId: resolveLiveAccountId(q.liveAccountId),
        orderNo: q.orderNo.trim(),
      })),
      fetchStatus: { in: ['success', 'empty'] },
    },
    select: {
      liveAccountId: true,
      orderNo: true,
      rawDetail: true,
      officialRefundAmountCent: true,
      afterSaleReason: true,
      afterSaleStatus: true,
      hasReturnRefund: true,
      hasRefundOnly: true,
      returnRefundCount: true,
      refundOnlyCount: true,
      afterSaleType: true,
      returnTypeCodes: true,
      successReturnCount: true,
      returnsIds: true,
    },
  })

  for (const row of rows) {
    const cacheKey = liveAccountOrderKey(row.liveAccountId, row.orderNo)
    const detail = row.rawDetail
    if (detail && Array.isArray(detail)) {
      const raws: Record<string, unknown>[] = []
      const norms: NormalizedAfterSaleRecord[] = []
      for (const item of detail) {
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        raws.push(rec)
        const norm = normalizeAfterSaleRecord(rec)
        if (norm) norms.push(norm)
      }
      if (raws.length > 0) {
        rawAfterSalesByOrderNo.set(cacheKey, raws)
      }
      const paidSet = paidOrderNos ?? new Set([row.orderNo])
      const built = buildAfterSaleByOrderNo(norms, paidSet)
      const agg = built.get(row.orderNo)
      if (agg) afterSaleByOrderNo.set(cacheKey, agg)
      continue
    }

    // rawDetail 缺失：用结构化字段恢复 afterSaleAgg（保证退货退款统计不依赖全量 JSON）
    if (
      row.hasReturnRefund ||
      row.hasRefundOnly ||
      row.officialRefundAmountCent > 0 ||
      (row.afterSaleType && row.afterSaleType !== 'none')
    ) {
      afterSaleByOrderNo.set(cacheKey, {
        orderNo: row.orderNo,
        refundAmountCent: row.officialRefundAmountCent,
        returnRefundAmountCent: row.hasReturnRefund ? row.officialRefundAmountCent : 0,
        afterSaleCount: row.successReturnCount || (row.officialRefundAmountCent > 0 ? 1 : 0),
        returnIds: row.returnsIds ? row.returnsIds.split(',').filter(Boolean) : [],
        reasons: row.afterSaleReason ? [row.afterSaleReason] : [],
        statuses: row.afterSaleStatus ? [row.afterSaleStatus] : [],
        hasRefund: row.officialRefundAmountCent > 0,
        hasReturnRefund: Boolean(row.hasReturnRefund),
        hasProductQualityRefund: false,
      })
    }
  }

  return { rawAfterSalesByOrderNo, afterSaleByOrderNo }
}

export { type LiveAccountOrderQuery, buildLiveAccountOrderQueries }

/** 批量入队：分页扫描 + 批量决策；不直接打平台 */
export async function enqueueWorkbenchSyncBatch(
  orderKeys: Array<{ liveAccountId: string; orderNo: string }>,
  opts?: { force?: boolean; source?: string },
): Promise<{
  scanned: number
  created: number
  reopened: number
  skipped: number
  failed: number
}> {
  const stats = { scanned: 0, created: 0, reopened: 0, skipped: 0, failed: 0 }
  const BATCH = 200
  for (let i = 0; i < orderKeys.length; i += BATCH) {
    const chunk = orderKeys.slice(i, i + BATCH)
    for (const k of chunk) {
      stats.scanned++
      try {
        const r = await enqueueWorkbenchSync(k.orderNo, k.liveAccountId, {
          force: opts?.force,
          source: opts?.source ?? 'enqueueWorkbenchSyncBatch',
        })
        if (r.reason === 'created') stats.created++
        else if (r.reopened) stats.reopened++
        else stats.skipped++
      } catch {
        stats.failed++
      }
    }
  }
  return stats
}

/**
 * 仅扫描并入队「有售后信号且缓存缺失/过期」的订单。
 * 禁止全量 P 单入队。
 */
export async function syncEligibleAfterSalesWorkbenchFromRaw(opts?: {
  /** 仅扫描近 N 天订单（按 paymentTime/orderedAt）；默认 45 */
  lookbackDays?: number
  source?: string
}): Promise<{
  enqueued: number
  processed: number
  scanned: number
  eligible: number
  batch?: {
    scanned: number
    created: number
    reopened: number
    skipped: number
    failed: number
  }
}> {
  const lookbackDays = Math.max(1, opts?.lookbackDays ?? 45)
  const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  const PAGE = 400
  let cursor: string | undefined
  const keys: Array<{ liveAccountId: string; orderNo: string }> = []
  let scanned = 0
  for (;;) {
    const rows = await prisma.xhsRawOrder.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        packageId: true,
        orderId: true,
        displayOrderNo: true,
        liveAccountId: true,
        afterSaleStatusText: true,
        orderStatusText: true,
        isReturned: true,
        paymentTime: true,
        orderedAt: true,
        rawJson: true,
      },
    })
    if (rows.length === 0) break
    for (const o of rows) {
      scanned++
      const payRaw = o.paymentTime ?? o.orderedAt
      const payMs =
        payRaw instanceof Date
          ? payRaw.getTime()
          : typeof payRaw === 'number'
            ? payRaw
            : 0
      if (payMs > 0 && payMs < sinceMs) continue
      const no = (o.packageId || o.displayOrderNo || o.orderId || '').trim()
      if (!no || !/^P/i.test(no)) continue
      const input: ShouldFetchWorkbenchInput = {
        displayOrderNo: no,
        officialOrderNo: no,
        afterSaleStatusText: o.afterSaleStatusText ?? undefined,
        orderStatusText: o.orderStatusText ?? undefined,
        isReturned: Boolean(o.isReturned),
        raw:
          o.rawJson && typeof o.rawJson === 'object'
            ? (o.rawJson as Record<string, unknown>)
            : undefined,
      }
      const elig = resolveAfterSalesQueueEligibility(input, {
        cacheMissingOrStale: true,
        cacheCurrentlyValid: false,
      })
      if (!elig.eligible) continue
      keys.push({ liveAccountId: o.liveAccountId, orderNo: no })
    }
    cursor = rows[rows.length - 1]!.id
    if (rows.length < PAGE) break
  }
  const batch = await enqueueWorkbenchSyncBatch(keys, {
    source: opts?.source ?? 'syncEligibleAfterSalesWorkbenchFromRaw',
  })
  await refreshWorkbenchMemoryCache()
  return {
    enqueued: batch.created + batch.reopened,
    processed: 0,
    scanned,
    eligible: keys.length,
    batch,
  }
}

/** @deprecated 请使用 syncEligibleAfterSalesWorkbenchFromRaw；内部不再全量 P 单入队 */
export async function syncAllOrdersWorkbenchFromRaw(): Promise<{
  enqueued: number
  processed: number
  batch?: {
    scanned: number
    created: number
    reopened: number
    skipped: number
    failed: number
  }
}> {
  const r = await syncEligibleAfterSalesWorkbenchFromRaw({
    lookbackDays: 45,
    source: 'syncAllOrdersWorkbenchFromRaw',
  })
  return {
    enqueued: r.enqueued,
    processed: r.processed,
    batch: r.batch,
  }
}
