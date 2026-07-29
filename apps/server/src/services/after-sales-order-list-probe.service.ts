/**
 * 售后回填：订单列表批量探测（POST fulfillment/order/page + multi_search_field）
 */
import {
  packageFromUnknown,
  resolveAfterSaleSignal,
  type AfterSaleSignal,
  type BatchOrderPackage,
} from './after-sale-batch-signal.service'
import { AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS } from './after-sales-queue.types'
import { getAfterSalesHttpDeps } from './after-sales-http-deps'
import {
  AfterSalesRequestError,
  classifyThrownHttpCause,
  emptyAfterSalesRequestCounters,
  finalizeAfterSalesRequestCounters,
  type AfterSalesRequestCounters,
} from './after-sales-request-error'
import { parseFiniteNonNegativeInt } from './after-sales-pagination.service'

const ORDER_LIST_URL = 'https://ark.xiaohongshu.com/api/edith/fulfillment/order/page'
const ORDER_LIST_REFERER = 'https://ark.xiaohongshu.com/app-order/order/query'
const API_NAME = 'after_sales_order_list_probe'

export type OrderProbeResult =
  | { orderNo: string; state: 'HAS_AFTER_SALE'; package: BatchOrderPackage }
  | { orderNo: string; state: 'NO_AFTER_SALE'; package: BatchOrderPackage }
  | { orderNo: string; state: 'UNKNOWN'; reason: string }

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function extractOrderListPackages(payload: unknown): {
  packages: Record<string, unknown>[]
  total: number | null
} {
  const root = asRecord(payload)
  if (!root) return { packages: [], total: null }
  const data = asRecord(root.data) ?? root
  const list = data.packages ?? data.list ?? data.records ?? data.items
  const packages = Array.isArray(list)
    ? list.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
    : []
  const total = parseFiniteNonNegativeInt(data.total ?? data.totalCount ?? data.total_count)
  return { packages, total }
}

export function buildOrderListBody(orderNos: string[], pageNo: number): Record<string, unknown> {
  const now = Date.now()
  const start = now - 400 * 24 * 60 * 60 * 1000
  return {
    page_no: pageNo,
    page_size: 20,
    multi_search_field: orderNos.join(','),
    order_tag_list: [],
    order_type_list: [],
    promise_ship_time_type_list: [],
    after_sale_status_list: [],
    seller_mark_priority_list: [],
    seller_mark_note_status_list: [],
    status: [],
    time_range_list: [
      {
        time_type: 3,
        start_time: start,
        end_time: now + 24 * 60 * 60 * 1000,
      },
    ],
    overdue_status: -2,
    sort_by: { sort_field: 'ordered_at', desc: true },
    need_declare_info: true,
    need_declare_times: true,
    allow_es_fallback: true,
  }
}

function mapPackagesToOrders(
  orderNos: string[],
  packages: Record<string, unknown>[],
): OrderProbeResult[] {
  const byPackageId = new Map<string, BatchOrderPackage[]>()
  for (const raw of packages) {
    const pkg = packageFromUnknown(raw)
    if (!pkg?.packageId) continue
    const key = pkg.packageId.trim()
    const list = byPackageId.get(key) ?? []
    list.push(pkg)
    byPackageId.set(key, list)
  }

  const out: OrderProbeResult[] = []
  for (const orderNo of orderNos) {
    const hits = byPackageId.get(orderNo) ?? []
    if (hits.length === 0) {
      out.push({
        orderNo,
        state: 'UNKNOWN',
        reason: 'ORDER_NOT_RETURNED_BY_BATCH_QUERY',
      })
      continue
    }
    if (hits.length > 1) {
      const signals = new Set(hits.map((h) => resolveAfterSaleSignal(h)))
      if (signals.size > 1) {
        out.push({
          orderNo,
          state: 'UNKNOWN',
          reason: 'DUPLICATE_OR_CONFLICTING_ORDER_RESULT',
        })
        continue
      }
    }
    const pkg = hits[0]!
    const signal: AfterSaleSignal = resolveAfterSaleSignal(pkg)
    if (signal === 'HAS_AFTER_SALE') {
      out.push({ orderNo, state: 'HAS_AFTER_SALE', package: pkg })
    } else if (signal === 'NO_AFTER_SALE') {
      out.push({ orderNo, state: 'NO_AFTER_SALE', package: pkg })
    } else {
      out.push({ orderNo, state: 'UNKNOWN', reason: 'UNKNOWN_AFTER_SALE_STATUS' })
    }
  }
  return out
}

export async function probeOrdersAfterSaleSignal(params: {
  liveAccountId: string
  orderNos: string[]
}): Promise<{
  results: OrderProbeResult[]
  counters: AfterSalesRequestCounters
  /** @deprecated 等于 networkRequests */
  httpRequests: number
  requestAttempts: number
  networkRequests: number
  error?: string
}> {
  const liveAccountId = String(params.liveAccountId ?? '').trim()
  const orderNos = [...new Set(params.orderNos.map((x) => String(x ?? '').trim()).filter(Boolean))]
  const zero = emptyAfterSalesRequestCounters()
  if (orderNos.length === 0) {
    return {
      results: [],
      counters: zero,
      httpRequests: 0,
      requestAttempts: 0,
      networkRequests: 0,
    }
  }
  if (orderNos.length > AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS) {
    throw new Error(
      `BATCH_ORDER_LIMIT_EXCEEDED: max=${AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS} got=${orderNos.length}`,
    )
  }
  if (!liveAccountId || liveAccountId === 'legacy') {
    throw new Error('ORDER_LIST_PROBE_REQUIRES_LIVE_ACCOUNT')
  }

  const deps = getAfterSalesHttpDeps()
  const cookie = await deps.cookieProvider(liveAccountId)
  let requestAttempts = 0
  let networkRequests = 0
  let locallyThrottled = 0
  const allPackages: Record<string, unknown>[] = []
  let pageNo = 1
  let total: number | null = null

  try {
    for (;;) {
      await deps.waitShopSlot(liveAccountId)
      const body = buildOrderListBody(orderNos, pageNo)
      requestAttempts++
      let payload: unknown
      try {
        const exec = await deps.httpExecutor({
          url: ORDER_LIST_URL,
          cookie,
          liveAccountId,
          method: 'POST',
          body,
          apiName: API_NAME,
          urlKey: '/fulfillment/order/page',
          referer: ORDER_LIST_REFERER,
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
            page: pageNo,
            causeCode: e.causeCode,
            networkSent: net > 0,
            httpStatus: e.httpStatus,
          })
        }
        networkRequests++
        const msg = e instanceof Error ? e.message : String(e)
        throw new AfterSalesRequestError({
          message: msg,
          requestAttempts,
          networkRequests,
          locallyThrottled,
          httpRequests: networkRequests,
          page: pageNo,
          causeCode: classifyThrownHttpCause(msg),
          networkSent: true,
        })
      }
      const extracted = extractOrderListPackages(payload)
      allPackages.push(...extracted.packages)
      if (total == null) total = extracted.total
      else if (extracted.total != null) total = Math.max(total, extracted.total)
      const got = allPackages.length
      if (total != null && got < total && extracted.packages.length > 0 && pageNo < 5) {
        pageNo++
        continue
      }
      break
    }
  } catch (e) {
    if (e instanceof AfterSalesRequestError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    throw new AfterSalesRequestError({
      message: msg,
      requestAttempts,
      networkRequests,
      locallyThrottled,
      httpRequests: networkRequests,
      page: pageNo,
      causeCode: classifyThrownHttpCause(msg),
      networkSent: networkRequests > 0,
    })
  }

  const counters = finalizeAfterSalesRequestCounters({
    requestAttempts,
    networkRequests,
    locallyThrottled,
  })
  return {
    results: mapPackagesToOrders(orderNos, allPackages),
    counters,
    httpRequests: counters.networkRequests,
    requestAttempts: counters.requestAttempts,
    networkRequests: counters.networkRequests,
  }
}

export function mapOrderListProbeForTest(
  orderNos: string[],
  packages: Record<string, unknown>[],
): OrderProbeResult[] {
  return mapPackagesToOrders(orderNos, packages)
}
