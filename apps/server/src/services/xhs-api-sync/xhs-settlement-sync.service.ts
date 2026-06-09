import { createHash } from 'node:crypto'
import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'
import type { XhsRequestAuditContext } from '../xhs-http.service'
import type { SyncProgressReporter } from './xhs-sync-progress.service'
import { resolveXhsDateRange } from './xhs-date-range.service'

const DEFAULT_MAX_PAGES = 500

export interface SyncSettlementListOnlyParams {
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
}

export interface SyncSettlementListOnlyResult {
  total: number
  itemCount: number
  pageCount: number
  savedCount?: number
  firstSettleNo: string | null
  firstPackageId: string | null
  warnings: string[]
  authFailed?: boolean
}

function buildPendingBody(
  startDateTimeText: string,
  endDateTimeText: string,
  pageNum: number,
  pageSize: number,
): Record<string, unknown> {
  return {
    sortBy: 'ORDER_CREATE_TIME',
    sortOrder: 'DESC',
    settleStatus: 'INIT',
    timeType: 'ORDER_CREATE_TIME',
    startTime: startDateTimeText,
    endTime: endDateTimeText,
    pageNum,
    pageSize,
  }
}

function buildSettledBody(
  startDateTimeText: string,
  endDateTimeText: string,
  pageNum: number,
  pageSize: number,
): Record<string, unknown> {
  return {
    timeType: 'SETTLE_TIME',
    startTime: startDateTimeText,
    endTime: endDateTimeText,
    settleStatus: 'SUCCESS',
    pageNum,
    pageSize,
  }
}

export function extractSettlementList(data: unknown): {
  items: Record<string, unknown>[]
  total: number
  totalPage: number
} {
  if (!data || typeof data !== 'object') return { items: [], total: 0, totalPage: 0 }
  const root = data as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const list = inner.list
  const items = Array.isArray(list)
    ? list.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
    : []
  const total = typeof inner.total === 'number' ? inner.total : items.length
  const totalPage =
    typeof inner.totalPage === 'number'
      ? inner.totalPage
      : total > 0
        ? Math.ceil(total / (items.length || 1))
        : 0
  return { items, total, totalPage }
}

function pickField(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (value != null && String(value).trim()) return String(value)
  }
  return null
}

function stableSettlementId(item: Record<string, unknown>): string {
  const settleNo = pickField(item, ['settleNo', 'settle_no', 'SETTLE_NO'])
  const packageId = pickField(item, ['packageId', 'package_id', 'PACKAGE_ID'])
  if (settleNo && packageId) return `${settleNo}__${packageId}`
  if (settleNo) return settleNo
  if (packageId) return `pkg_${packageId}`
  return createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 24)
}

async function syncSettlementListOnlyInner(
  apiKey: 'pending_settlement_list' | 'settled_settlement_list',
  params: SyncSettlementListOnlyParams,
  saveFn?: (item: Record<string, unknown>, syncJobId: string | null | undefined) => Promise<boolean>,
): Promise<SyncSettlementListOnlyResult> {
  if (!isApiConfigured(apiKey)) {
    return {
      total: 0,
      itemCount: 0,
      pageCount: 0,
      savedCount: 0,
      firstSettleNo: null,
      firstPackageId: null,
      warnings: [`${apiKey} 接口未配置`],
    }
  }

  const def = getApiDefinition(apiKey)
  const pageSize = params.pageSize ?? def.pageSize
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES
  const range = resolveXhsDateRange('custom', params.startDate, params.endDate)

  const warnings: string[] = []
  let pageNum = 1
  let pageCount = 0
  let itemCount = 0
  let savedCount = 0
  let total = 0
  let totalPage = 0
  let firstSettleNo: string | null = null
  let firstPackageId: string | null = null

  while (pageNum <= maxPages) {
    await params.progress?.beforeRequest(apiKey, pageNum, totalPage > 0 ? totalPage : null)

    const body =
      apiKey === 'pending_settlement_list'
        ? buildPendingBody(range.startDateTimeText, range.endDateTimeText, pageNum, pageSize)
        : buildSettledBody(range.startDateTimeText, range.endDateTimeText, pageNum, pageSize)

    const res = await requestXhsApi({
      apiKey,
      liveAccountId: params.liveAccountId,
      body,
      context: params.context,
    })
    pageCount++
    const ok = Boolean(res.ok && res.data)
    await params.progress?.afterRequest(ok)

    if (!ok) {
      warnings.push(res.errorMessage ?? `第 ${pageNum} 页请求失败`)
      if (res.authError) {
        return {
          total,
          itemCount,
          pageCount,
          savedCount: saveFn ? savedCount : undefined,
          firstSettleNo,
          firstPackageId,
          warnings,
          authFailed: true,
        }
      }
      break
    }

    const block = extractSettlementList(res.data)
    total = block.total || total
    totalPage = block.totalPage || totalPage

    for (const item of block.items) {
      if (!firstSettleNo) firstSettleNo = pickField(item, ['settleNo', 'settle_no'])
      if (!firstPackageId) firstPackageId = pickField(item, ['packageId', 'package_id'])
      itemCount++
      if (saveFn) {
        const saved = await saveFn(item, params.syncJobId)
        if (saved) savedCount++
      }
    }

    if (block.items.length === 0) break
    if (totalPage > 0 && pageNum >= totalPage) break
    if (total > 0 && pageNum * pageSize >= total) break
    if (block.items.length < pageSize) break

    pageNum++
  }

  if (pageNum > maxPages) {
    warnings.push(`已达到最大页数保护 ${maxPages}`)
  }

  return {
    total,
    itemCount,
    pageCount,
    savedCount: saveFn ? savedCount : undefined,
    firstSettleNo,
    firstPackageId,
    warnings,
  }
}

export async function syncPendingSettlementListOnly(
  params: SyncSettlementListOnlyParams,
): Promise<SyncSettlementListOnlyResult> {
  if (params.saveToDb) {
    const { savePendingSettlementItem } = await import('./xhs-settlement-save.service')
    return syncSettlementListOnlyInner('pending_settlement_list', params, savePendingSettlementItem)
  }
  return syncSettlementListOnlyInner('pending_settlement_list', params)
}

export async function syncSettledSettlementListOnly(
  params: SyncSettlementListOnlyParams,
): Promise<SyncSettlementListOnlyResult> {
  if (params.saveToDb) {
    const { saveSettledSettlementItem } = await import('./xhs-settlement-save.service')
    return syncSettlementListOnlyInner('settled_settlement_list', params, saveSettledSettlementItem)
  }
  return syncSettlementListOnlyInner('settled_settlement_list', params)
}

export { stableSettlementId }

export async function syncPendingSettlementList(
  params: {
    syncJobId: string
    startDate: string
    endDate: string
    context?: XhsRequestAuditContext
    progress?: SyncProgressReporter
    liveAccountId?: string
    liveAccountName?: string
  },
): Promise<{ itemCount: number; requestCount: number; warnings: string[]; authFailed?: boolean }> {
  const result = await syncPendingSettlementListOnly({
    ...params,
    saveToDb: true,
    syncJobId: params.syncJobId,
    progress: params.progress,
  })
  return {
    itemCount: result.savedCount ?? result.itemCount,
    requestCount: result.pageCount,
    warnings: result.warnings,
    authFailed: result.authFailed,
  }
}

export async function syncSettledSettlementList(
  params: {
    syncJobId: string
    startDate: string
    endDate: string
    context?: XhsRequestAuditContext
    progress?: SyncProgressReporter
    liveAccountId?: string
    liveAccountName?: string
  },
): Promise<{ itemCount: number; requestCount: number; warnings: string[]; authFailed?: boolean }> {
  const result = await syncSettledSettlementListOnly({
    ...params,
    saveToDb: true,
    syncJobId: params.syncJobId,
    progress: params.progress,
  })
  return {
    itemCount: result.savedCount ?? result.itemCount,
    requestCount: result.pageCount,
    warnings: result.warnings,
    authFailed: result.authFailed,
  }
}
