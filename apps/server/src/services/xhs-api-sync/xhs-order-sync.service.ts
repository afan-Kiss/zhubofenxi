import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'
import type { XhsApiKey } from './xhs-api-types'
import type { XhsRequestAuditContext } from '../xhs-http.service'
import { resolveDateRange } from '../../utils/date-range'
import type { SyncProgressReporter } from './xhs-sync-progress.service'

import {
  extractApiHasMore,
  extractApiTotal,
  SAFE_MAX_PAGES,
  shouldStopPagination,
} from './xhs-page-pagination.util'
import { pickOfficialDisplayOrderNo } from '../order-display-no.service'

const DEFAULT_MAX_PAGES = SAFE_MAX_PAGES

export interface SyncOrderListOnlyParams {
  startDate: string
  endDate: string
  pageSize?: number
  maxPages?: number
  saveToDb?: boolean
  syncJobId?: string | null
  context?: XhsRequestAuditContext
  progress?: SyncProgressReporter
  liveAccountId?: string
  liveAccountName?: string
  accountIndex?: number
  accountTotal?: number
}

export interface SyncOrderListOnlyResult {
  total: number
  itemCount: number
  pageCount: number
  savedCount?: number
  firstOrderId: string | null
  firstPackageId: string | null
  warnings: string[]
  authFailed?: boolean
  syncStopped?: boolean
  createdCount?: number
  updatedCount?: number
  skippedCount?: number
}

export interface FetchOrderPackagesResult {
  packages: Record<string, unknown>[]
  total: number
  pageCount: number
  warnings: string[]
}

export type LiveFetchProgressCb = (info: {
  message: string
  fetchedPages: number
  totalPages: number | null
  totalOrders: number
}) => void

/** 仅从接口分页拉取订单包裹（默认不入库），用于 live-query 现场统计 */
export async function fetchOrderPackagesForRange(params: {
  startDate: string
  endDate: string
  pageSize?: number
  maxPages?: number
  context?: XhsRequestAuditContext
  onProgress?: LiveFetchProgressCb
}): Promise<FetchOrderPackagesResult> {
  if (!isApiConfigured('order_list')) {
    return { packages: [], total: 0, pageCount: 0, warnings: ['订单列表接口未配置'] }
  }

  const def = getApiDefinition('order_list')
  const pageSize = params.pageSize ?? def.pageSize
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES
  const range = resolveDateRange('custom', params.startDate, params.endDate)

  const warnings: string[] = []
  const packages: Record<string, unknown>[] = []
  let pageNo = 1
  let pageCount = 0
  let total = 0
  let totalPageEstimate: number | null = null

  params.onProgress?.({
    message: '正在请求订单接口...',
    fetchedPages: 0,
    totalPages: null,
    totalOrders: 0,
  })

  while (pageNo <= maxPages) {
    params.onProgress?.({
      message: `正在读取第 ${pageNo} 页...`,
      fetchedPages: pageNo,
      totalPages: totalPageEstimate,
      totalOrders: packages.length,
    })

    const res = await requestXhsApi({
      apiKey: 'order_list',
      body: buildOrderListBody(pageNo, pageSize, range.startTimeMs, range.endTimeMs),
      context: params.context,
    })
    pageCount++

    if (!res.ok || !res.data) {
      warnings.push(res.errorMessage ?? `第 ${pageNo} 页请求失败`)
      break
    }

    const pagePackages = extractOrderPackages(res.data)
    total = extractApiTotal(res.data) || total
    if (total > 0) totalPageEstimate = Math.ceil(total / pageSize)

    for (const item of pagePackages) {
      packages.push(item)
    }

    params.onProgress?.({
      message: `已读取 ${packages.length} 条订单...`,
      fetchedPages: pageNo,
      totalPages: totalPageEstimate,
      totalOrders: packages.length,
    })

    if (
      shouldStopPagination({
        rowsThisPage: pagePackages.length,
        pageSize,
        pageNo,
        hasMore: extractApiHasMore(res.data),
        totalEstimate: total,
        accumulatedRows: packages.length,
      })
    ) {
      break
    }

    pageNo++
  }

  if (pageNo > maxPages) {
    warnings.push(`已达到最大页数保护 ${maxPages}，可能未拉取完整数据`)
  }

  const deduped = dedupeOrderPackages(packages)
  if (deduped.length < packages.length) {
    warnings.push(`订单去重：${packages.length} → ${deduped.length}`)
  }
  if (deduped.length === 200 && pageCount <= 5) {
    warnings.push('订单可能未全量读取，请检查分页停止条件')
  }

  return { packages: deduped, total, pageCount, warnings }
}

function dedupeOrderPackages(packages: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const pkg of packages) {
    const picked = pickOfficialDisplayOrderNo(pkg)
    const key =
      picked.displayOrderNo?.trim() ||
      String(pkg.packageId ?? pkg.package_id ?? pkg.orderId ?? pkg.order_id ?? '').trim() ||
      `row:${out.length}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(pkg)
  }
  return out
}

export function buildOrderListBody(
  pageNo: number,
  pageSize: number,
  startMs: number,
  endMs: number,
): Record<string, unknown> {
  return {
    page_no: pageNo,
    page_size: pageSize,
    multi_search_field: '',
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
        start_time: startMs,
        end_time: endMs,
      },
    ],
    overdue_status: -2,
    sort_by: {
      sort_field: 'ordered_at',
      desc: true,
    },
    need_declare_info: true,
    need_declare_times: true,
    allow_es_fallback: true,
  }
}

export function extractOrderPackages(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const root = data as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const packages = inner.packages
  if (!Array.isArray(packages)) return []
  return packages.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
}

function extractTotal(data: unknown): number {
  if (!data || typeof data !== 'object') return 0
  const root = data as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const total = inner.total ?? inner.totalCount
  return typeof total === 'number' ? total : 0
}

function pickId(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (value != null && String(value).trim()) return String(value)
  }
  return null
}

/** 仅同步订单列表（分页），默认不入库 */
export async function syncOrderListOnly(
  params: SyncOrderListOnlyParams,
): Promise<SyncOrderListOnlyResult> {
  if (!isApiConfigured('order_list')) {
    return {
      total: 0,
      itemCount: 0,
      pageCount: 0,
      savedCount: 0,
      firstOrderId: null,
      firstPackageId: null,
      warnings: ['订单列表接口未配置'],
    }
  }

  if (params.saveToDb) {
    const { syncOrderListOnlyWithSave } = await import('./xhs-order-save.service')
    return syncOrderListOnlyWithSave(params)
  }

  const def = getApiDefinition('order_list')
  const pageSize = params.pageSize ?? def.pageSize
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES
  const range = resolveDateRange('custom', params.startDate, params.endDate)

  const warnings: string[] = []
  let pageNo = 1
  let pageCount = 0
  let itemCount = 0
  let total = 0
  let firstOrderId: string | null = null
  let firstPackageId: string | null = null

  while (pageNo <= maxPages) {
    const res = await requestXhsApi({
      apiKey: 'order_list',
      body: buildOrderListBody(pageNo, pageSize, range.startTimeMs, range.endTimeMs),
      context: params.context,
    })
    pageCount++

    if (!res.ok || !res.data) {
      warnings.push(res.errorMessage ?? `第 ${pageNo} 页请求失败`)
      break
    }

    const packages = extractOrderPackages(res.data)
    total = extractApiTotal(res.data) || total

    for (const item of packages) {
      if (!firstOrderId) {
        firstOrderId = pickId(item, ['orderId', 'order_id', 'orderNo', 'order_no'])
      }
      if (!firstPackageId) {
        firstPackageId = pickId(item, ['packageId', 'package_id', 'packageNo', 'package_no'])
      }
      itemCount++
    }

    if (
      shouldStopPagination({
        rowsThisPage: packages.length,
        pageSize,
        pageNo,
        hasMore: extractApiHasMore(res.data),
        totalEstimate: total,
        accumulatedRows: itemCount,
      })
    ) {
      break
    }

    pageNo++
  }

  if (pageNo > maxPages) {
    warnings.push(`已达到最大页数保护 ${maxPages}，可能未拉取完整数据`)
  }

  return {
    total,
    itemCount,
    pageCount,
    firstOrderId,
    firstPackageId,
    warnings,
  }
}

export interface SyncPaginatedParams<T> {
  apiKey: XhsApiKey
  syncJobId: string
  startDate: string
  endDate: string
  buildBody: (ctx: { pageNum: number; pageSize: number; cursor?: string }) => unknown
  extractItems: (data: unknown) => T[]
  extractTotal?: (data: unknown) => number | undefined
  extractHasMore?: (data: unknown) => boolean
  extractNextCursor?: (data: unknown) => string | undefined
  onItem: (item: T) => Promise<void>
  context?: XhsRequestAuditContext
  onProgress?: (done: number, total?: number) => void
  progress?: SyncProgressReporter
}

export async function syncPaginatedApi<T>(params: SyncPaginatedParams<T>): Promise<{
  itemCount: number
  requestCount: number
  warnings: string[]
}> {
  const def = getApiDefinition(params.apiKey)
  const warnings: string[] = []
  let pageNum = 1
  let cursor: string | undefined
  let itemCount = 0
  let requestCount = 0
  let hasMore = true
  let totalPageEstimate: number | null = null

  while (hasMore) {
    await params.progress?.beforeRequest(params.apiKey, pageNum, totalPageEstimate)

    const body = params.buildBody({
      pageNum,
      pageSize: def.pageSize,
      cursor,
    })
    const res = await requestXhsApi({
      apiKey: params.apiKey,
      body,
      context: params.context,
    })
    requestCount++
    const ok = Boolean(res.ok && res.data)
    await params.progress?.afterRequest(ok)

    if (!ok) {
      warnings.push(res.errorMessage ?? `${def.name}请求失败`)
      break
    }

    const itemTotal = params.extractTotal?.(res.data)
    if (itemTotal != null && itemTotal > 0) {
      totalPageEstimate = Math.ceil(itemTotal / def.pageSize)
    }

    const items = params.extractItems(res.data!)
    for (const item of items) {
      await params.onItem(item)
      itemCount++
    }
    params.onProgress?.(itemCount, params.extractTotal?.(res.data))

    const more =
      params.extractHasMore?.(res.data) ??
      (items.length >= def.pageSize &&
        (params.extractTotal?.(res.data) == null ||
          itemCount < (params.extractTotal(res.data) ?? 0)))

    hasMore = more
    if (!hasMore) break

    const next = params.extractNextCursor?.(res.data)
    if (def.pageMode === 'cursor' && next) {
      cursor = next
    } else {
      pageNum++
    }
  }

  return { itemCount, requestCount, warnings }
}

export async function syncOrderList(params: {
  syncJobId: string
  startDate: string
  endDate: string
  context?: XhsRequestAuditContext
  onProgress?: (done: number) => void
  progress?: SyncProgressReporter
  liveAccountId?: string
  liveAccountName?: string
  accountIndex?: number
  accountTotal?: number
}): Promise<{ itemCount: number; requestCount: number; warnings: string[]; authFailed?: boolean; syncStopped?: boolean; apiRowCount?: number; createdCount?: number; updatedCount?: number }> {
  const result = await syncOrderListOnly({
    startDate: params.startDate,
    endDate: params.endDate,
    saveToDb: true,
    syncJobId: params.syncJobId,
    context: params.context,
    progress: params.progress,
    liveAccountId: params.liveAccountId,
    liveAccountName: params.liveAccountName,
    accountIndex: params.accountIndex,
    accountTotal: params.accountTotal,
  })
  params.onProgress?.(result.savedCount ?? result.itemCount)
  return {
    itemCount: result.savedCount ?? result.itemCount,
    requestCount: result.pageCount,
    warnings: result.warnings,
    authFailed: result.authFailed,
    syncStopped: result.syncStopped,
    apiRowCount: result.itemCount,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
  }
}

export async function syncOrderDetails(params: {
  syncJobId: string
  context?: XhsRequestAuditContext
  onProgress?: (done: number, total: number) => void
}): Promise<{ itemCount: number; requestCount: number; warnings: string[] }> {
  void params
  return {
    itemCount: 0,
    requestCount: 0,
    warnings: ['订单详情同步尚未启用（阶段八后暂停）'],
  }
}
