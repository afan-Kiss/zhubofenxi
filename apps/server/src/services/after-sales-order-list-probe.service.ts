/**
 * 售后回填：订单列表批量探测（POST fulfillment/order/page + multi_search_field）
 */
import { getDecryptedCookieByAccountId } from './live-account.service'
import { requestXhsJsonWithSyncAudit } from './sync-request-audit.service'
import { enqueueXhsRequest } from './xhs-api-sync/xhs-rate-limiter.service'
import { waitShopEndpointSlot } from './after-sales-shop-rate.service'
import {
  packageFromUnknown,
  resolveAfterSaleSignal,
  type AfterSaleSignal,
  type BatchOrderPackage,
} from './after-sale-batch-signal.service'
import { AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS } from './after-sales-queue.types'

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
  const totalRaw = data.total ?? data.totalCount ?? data.total_count
  const total = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : null
  return { packages, total }
}

function buildOrderListBody(orderNos: string[], pageNo: number): Record<string, unknown> {
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

/**
 * 同店批量探测售后信号。超过 10 单抛 BATCH_ORDER_LIMIT_EXCEEDED。
 */
export async function probeOrdersAfterSaleSignal(params: {
  liveAccountId: string
  orderNos: string[]
}): Promise<{
  results: OrderProbeResult[]
  httpRequests: number
  error?: string
}> {
  const liveAccountId = String(params.liveAccountId ?? '').trim()
  const orderNos = [...new Set(params.orderNos.map((x) => String(x ?? '').trim()).filter(Boolean))]
  if (orderNos.length === 0) return { results: [], httpRequests: 0 }
  if (orderNos.length > AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS) {
    throw new Error(
      `BATCH_ORDER_LIMIT_EXCEEDED: max=${AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS} got=${orderNos.length}`,
    )
  }
  if (!liveAccountId || liveAccountId === 'legacy') {
    throw new Error('ORDER_LIST_PROBE_REQUIRES_LIVE_ACCOUNT')
  }

  const cookie = await getDecryptedCookieByAccountId(liveAccountId)
  let httpRequests = 0
  const allPackages: Record<string, unknown>[] = []
  let pageNo = 1
  let total: number | null = null

  for (;;) {
    await waitShopEndpointSlot(liveAccountId, 'order_list_probe')
    const body = buildOrderListBody(orderNos, pageNo)
    httpRequests++
    const payload = await enqueueXhsRequest(() =>
      requestXhsJsonWithSyncAudit<unknown>({
        shopId: liveAccountId,
        apiName: API_NAME,
        method: 'POST',
        urlKey: '/fulfillment/order/page',
        trigger: 'scheduled',
        options: {
          method: 'POST',
          url: ORDER_LIST_URL,
          cookie,
          referer: ORDER_LIST_REFERER,
          body,
          needSign: true,
          parseEnvelope: true,
        },
      }),
    )
    const extracted = extractOrderListPackages(payload)
    allPackages.push(...extracted.packages)
    if (total == null) total = extracted.total
    const got = allPackages.length
    if (total != null && got < total && extracted.packages.length > 0 && pageNo < 5) {
      pageNo++
      continue
    }
    break
  }

  return {
    results: mapPackagesToOrders(orderNos, allPackages),
    httpRequests,
  }
}

/** 纯函数：供单测映射 */
export function mapOrderListProbeForTest(
  orderNos: string[],
  packages: Record<string, unknown>[],
): OrderProbeResult[] {
  return mapPackagesToOrders(orderNos, packages)
}
