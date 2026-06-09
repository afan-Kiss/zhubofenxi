import { createHash } from 'node:crypto'
import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'
import type { XhsRequestAuditContext } from '../xhs-http.service'
import type { SyncProgressReporter } from './xhs-sync-progress.service'

const DEFAULT_MAX_PAGES = 100

export interface SyncLiveSessionListOnlyParams {
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

export interface SyncLiveSessionListOnlyResult {
  total: number
  itemCount: number
  pageCount: number
  savedCount?: number
  firstLiveId: string | null
  firstLiveName: string | null
  warnings: string[]
  authFailed?: boolean
  syncStopped?: boolean
}

export function buildLiveSessionListBody(
  startDate: string,
  endDate: string,
  page: number,
  size: number,
): Record<string, unknown> {
  return {
    requestBody: {
      blockElements: [
        {
          filterMap: {
            dateSelectType: 'custom',
            dateType: 0,
            startDate,
            endDate,
            anchorType: 0,
            anchorId: 'all',
          },
          page,
          size,
          orderBy: [
            { field: 'liveStartTime', orderBy: 'desc' },
            { field: 'liveId', orderBy: 'asc' },
          ],
          blockKey: 'sellerLiveDetailData',
        },
      ],
    },
  }
}

export function extractLiveBlock(data: unknown): {
  items: Record<string, unknown>[]
  total: number
} {
  if (!data || typeof data !== 'object') return { items: [], total: 0 }
  const root = data as Record<string, unknown>
  const outer = root.data

  if (Array.isArray(outer) && outer.length > 0) {
    const block = outer[0] as Record<string, unknown>
    const list = block.data
    const items = Array.isArray(list)
      ? list.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
      : []
    const total = typeof block.count === 'number' ? block.count : items.length
    return { items, total }
  }

  return { items: [], total: 0 }
}

function extractFieldValue(item: Record<string, unknown>, fieldName: string): unknown {
  const field = item[fieldName]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value !== undefined && f.value !== null && String(f.value).trim() !== '') {
      return f.value
    }
    if (f.displayValue !== undefined && f.displayValue !== null && String(f.displayValue).trim() !== '') {
      return f.displayValue
    }
  }
  return item[fieldName]
}

function pickLiveField(item: Record<string, unknown>, fieldName: string): string | null {
  const value = extractFieldValue(item, fieldName)
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

/** 仅同步直播场次列表（分页），默认不入库 */
export async function syncLiveSessionListOnly(
  params: SyncLiveSessionListOnlyParams,
): Promise<SyncLiveSessionListOnlyResult> {
  if (!isApiConfigured('live_session_list')) {
    return {
      total: 0,
      itemCount: 0,
      pageCount: 0,
      savedCount: 0,
      firstLiveId: null,
      firstLiveName: null,
      warnings: ['直播场次列表接口未配置'],
    }
  }

  if (params.saveToDb) {
    const { syncLiveSessionListOnlyWithSave } = await import('./xhs-live-save.service')
    return syncLiveSessionListOnlyWithSave(params)
  }

  const def = getApiDefinition('live_session_list')
  const pageSize = params.pageSize ?? def.pageSize
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES

  const warnings: string[] = []
  let page = 1
  let pageCount = 0
  let itemCount = 0
  let total = 0
  let firstLiveId: string | null = null
  let firstLiveName: string | null = null

  while (page <= maxPages) {
    const res = await requestXhsApi({
      apiKey: 'live_session_list',
      body: buildLiveSessionListBody(params.startDate, params.endDate, page, pageSize),
      context: params.context,
    })
    pageCount++

    if (!res.ok || !res.data) {
      warnings.push(res.errorMessage ?? `第 ${page} 页请求失败`)
      break
    }

    const block = extractLiveBlock(res.data)
    total = block.total || total

    for (const item of block.items) {
      if (!firstLiveId) firstLiveId = pickLiveField(item, 'liveId')
      if (!firstLiveName) firstLiveName = pickLiveField(item, 'liveName')
      itemCount++
    }

    if (block.items.length === 0) break
    if (total > 0 && page * pageSize >= total) break
    if (block.items.length < pageSize) break

    page++
  }

  if (page > maxPages && total > page * pageSize) {
    warnings.push(`已达到最大页数保护 ${maxPages}，可能未拉取完整数据`)
  }

  return {
    total,
    itemCount,
    pageCount,
    firstLiveId,
    firstLiveName,
    warnings,
  }
}

export function stableLiveSessionId(item: Record<string, unknown>): string {
  const liveId = pickLiveField(item, 'liveId')
  if (liveId) return liveId
  return createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 24)
}

export async function syncLiveSessionList(params: {
  syncJobId: string
  startDate: string
  endDate: string
  context?: XhsRequestAuditContext
  progress?: SyncProgressReporter
  liveAccountId?: string
  liveAccountName?: string
  accountIndex?: number
  accountTotal?: number
}): Promise<{ itemCount: number; requestCount: number; warnings: string[]; authFailed?: boolean; syncStopped?: boolean; apiRowCount?: number }> {
  const result = await syncLiveSessionListOnly({
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
  return {
    itemCount: result.savedCount ?? result.itemCount,
    requestCount: result.pageCount,
    warnings: result.warnings,
    authFailed: result.authFailed,
    syncStopped: result.syncStopped,
    apiRowCount: result.itemCount,
  }
}

export async function syncLiveSessionDetails(params: {
  syncJobId: string
  context?: XhsRequestAuditContext
  onProgress?: (done: number, total: number) => void
}): Promise<{ itemCount: number; requestCount: number; warnings: string[] }> {
  void params
  return {
    itemCount: 0,
    requestCount: 0,
    warnings: ['直播详情同步尚未启用'],
  }
}
