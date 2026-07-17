import { apiRequest } from './api'
import type { BoardRangePreset } from './board-range'
import { resolveBoardRangeDates } from './board-range'
import type { QualityFeedbackStatus } from '../components/board/OfficialQualitySyncNote'
import type { CookieHealthPayload } from './live-account'
import type { SyncJobView } from './sync-status'
import {
  BUYER_PROFILE_EXPECTED_CACHE_VERSION,
} from './buyer-profile-cache'

export interface BoardActiveSyncJob extends SyncJobView {
  afterSaleCount?: number
  qualityCaseCount?: number
}

export interface LiveQueryProgress {
  totalPages: number
  fetchedPages: number
  totalOrders: number
  message: string
}

export interface BoardSyncMeta {
  businessSync: {
    lastRunAt: string | null
    lastSuccessAt: string | null
    failedAt: string | null
    nextRunAt: string | null
    status: 'success' | 'failed' | 'running' | 'idle' | 'queued'
    intervalMinutes: number
    /** 与系统设置 apiSyncEnabled 一致 */
    enabled: boolean
    message: string
    lastError: string | null
    currentTask?: { reason: string; startedAt: string } | null
  }
  buyerRankingSync: {
    lastRunAt: string | null
    nextRunAt: string | null
    status: 'success' | 'failed' | 'running' | 'idle'
    message: string
    lastError: string | null
    cacheVersion: string | null
  }
  cookieHealth?: CookieHealthPayload
  syncRunning?: boolean
  activeSyncJob?: BoardActiveSyncJob | null
  totalRawOrders?: number
  totalRawLiveSessions?: number
  totalAfterSaleRecords?: number
  totalQualityCases?: number
  buyerProfileStatus?: BuyerProfileStatus
  rollingDataHealthClose?: RollingDataHealthCloseSummary | null
}

export interface RollingDataHealthCloseSummary {
  generatedAt: string
  startDate: string
  endDate: string
  rangeLabel: string
  gmvAmountYuan: number
  actualSignedAmountYuan: number
  refundAmountYuan: number
  paidOrderCount: number
  signedOrderCount: number
  refundOrderCount: number
  signRate: number | null
  refundRate: number | null
  qualityRefundOrderCount: number
  qualityRefundRate: number | null
  /** @deprecated 兼容旧字段，等同 afterSaleSignalRecordCount */
  afterSaleRecordCount: number
  afterSaleRelatedOrderCount: number
  afterSaleSignalRecordCount: number
  afterSaleCacheRecordCount: number
  afterSaleCacheRecordScope: 'all_db' | 'range'
  unassignedOrderCount: number
  duplicateOrderCount: number
  returnRefundOrderCount: number
  refundOnlyOrderCount: number
  unknownRefundTypeOrderCount: number
  classifiedRefundOrderCount: number
  returnRefundTypeIncomplete: boolean
  warnings: string[]
}

export interface BuyerProfileStatus {
  status:
    | 'ready'
    | 'stale_with_cache'
    | 'rebuilding'
    | 'empty'
    | 'failed'
    | 'stale'
    | 'building'
    | 'error'
  rebuilding?: boolean
  startedAt?: string | null
  updatedAt?: string | null
  lastSuccessAt?: string | null
  lastError?: string | null
  durationMs?: number | null
  runningSeconds?: number | null
  isStaleRunning?: boolean
  hasStaleCache?: boolean
  cacheVersion?: string | null
  expectedCacheVersion?: string
  cacheCompatible?: boolean
  rebuildScheduled?: boolean
  lastBuiltAt: string | null
  sampleOrderCount: number
  sampleCustomerCount: number
  progress: number | null
  message: string
}

export async function fetchSyncStatusFull(signal?: AbortSignal) {
  return apiRequest<{
    running: boolean
    job: BoardActiveSyncJob | null
    businessSync: BoardSyncMeta['businessSync']
    buyerRankingSync: BoardSyncMeta['buyerRankingSync']
  }>('/api/sync/status', { signal })
}

export type BoardDataDisplayStatus =
  | 'ready'
  | 'syncing_with_cache'
  | 'syncing_no_cache'
  | 'failed_with_cache'
  | 'empty'
  | 'coverage_missing'

export interface OverviewMeta {
  cacheKey: string
  cacheBuiltAt: string | null
  sourceSyncJobId: string | null
  sourceDataMaxTime: string | null
  businessCacheHit: boolean
  cacheStale: boolean
  fallbackReason: string | null
  dataVersionText: string
  recalculatedAt: string | null
  latestOrderTime: string | null
  lastQianfanSyncAt: string | null
  dataVersionId: string | null
  stableSnapshot?: {
    monthKey: string
    validSalesAmount: number
    cacheBuiltAt: string
    sourceSyncJobId: string | null
    label: string
  } | null
  stableVsLatest?: {
    stableValidSalesAmount: number
    latestValidSalesAmount: number
    diffAmount: number
    needsManualUpdate: boolean
    message: string | null
  } | null
}

export type BoardDataSource = 'local_db' | 'live_api'

export type AfterSalesCompletenessView = {
  status: 'complete' | 'partial' | 'pending' | 'blocked' | 'failed'
  pendingCount: number
  retryWaitCount: number
  blockedCount: number
  failedCount: number
  runningCount?: number
  doneCount?: number
  affectedOrderCount?: number
  affectedGmv?: number
  affectedAnchorNames?: string[]
  affectedShopNames?: string[]
  oldestOpenAt?: string | null
  lastSuccessAt?: string | null
  lastEmptySuccessAt?: string | null
  globalPendingCount?: number
  note: string
  scope?: 'global' | 'range'
}

export interface BoardLiveQueryData {
  requestId: string
  preset: string
  startDate: string
  endDate: string
  rangeKey?: string
  /** 页面查询身份：pageScope|preset|start|end */
  queryKey?: string
  pageScope?: 'overview' | 'anchors'
  resolvedRange?: BoardResolvedRange
  source: BoardDataSource
  isFromCache: boolean
  fetchedAt: string
  dataDisplayStatus?: BoardDataDisplayStatus
  rangeCoverage?: {
    status: 'covered' | 'not_covered' | 'syncing' | 'unknown'
    reason?: string
    coveredShopIds?: string[]
    missingShopIds?: string[]
    syncingShopIds?: string[]
    failedShopIds?: string[]
    unknownShopIds?: string[]
    missingShopNames?: string[]
    evidenceJobId?: string | null
  }
  diagnostics?: Record<string, unknown>
  progress: LiveQueryProgress
  summary: Record<string, unknown>
  anchorPerformanceSummary?: Record<string, unknown>
  anchorLeaderboard: Array<Record<string, unknown>>
  orders: Array<Record<string, unknown>>
  allOrders: Array<Record<string, unknown>>
  ordersTotal: number
  page: number
  pageSize: number
  blacklistedBuyerIds: string[]
  debug: {
    orderNos: string[]
    includedOrderNos: string[]
    excludedOrderNos: string[]
    gmvField: string
    formulaVersion: string
  }
  qualityFeedback?: QualityFeedbackStatus
  afterSalesCompleteness?: AfterSalesCompletenessView
  globalAfterSalesCompleteness?: AfterSalesCompletenessView
  syncMeta?: BoardSyncMeta
  overviewMeta?: OverviewMeta
}

export interface BoardResolvedRange {
  preset: string
  startDate: string
  endDate: string
}

export type BoardFetchResult = {
  data: BoardLiveQueryData
  etag?: string
  dataGeneration?: string
  notModified?: boolean
  cacheStatus?: string
}

async function fetchBoardRangeDataResult(
  path: 'overview-data' | 'anchors-data' | 'local-data',
  params: {
    preset: BoardRangePreset
    startDate?: string
    endDate?: string
    includeAnchorLeaderboard?: boolean
    signal?: AbortSignal
    etag?: string
  },
): Promise<BoardFetchResult> {
  if (params.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const dates = resolveBoardRangeDates(
    params.preset,
    params.startDate ?? '',
    params.endDate ?? '',
  )
  const qs = new URLSearchParams({ preset: params.preset })
  if (dates.startDate) qs.set('startDate', dates.startDate)
  if (dates.endDate) qs.set('endDate', dates.endDate)
  if (path === 'local-data' && params.includeAnchorLeaderboard === false) {
    qs.set('includeAnchorLeaderboard', '0')
  }
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (params.etag) headers['If-None-Match'] = params.etag

  const res = await fetch(`/api/board/${path}?${qs}`, {
    credentials: 'include',
    signal: params.signal,
    headers,
  })
  const etag = res.headers.get('etag') || undefined
  const dataGeneration = res.headers.get('x-data-generation') || undefined
  const cacheStatus = res.headers.get('x-board-cache') || undefined
  if (res.status === 304) {
    return { data: null as unknown as BoardLiveQueryData, etag, dataGeneration, notModified: true, cacheStatus }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
  const body = (await res.json()) as { ok?: boolean; data?: BoardLiveQueryData; message?: string }
  if (!body.ok || !body.data) {
    throw new Error(body.message || '看板数据返回异常')
  }
  return {
    data: body.data,
    etag,
    dataGeneration,
    cacheStatus,
  }
}

async function fetchBoardRangeData(
  path: 'overview-data' | 'anchors-data' | 'local-data',
  params: {
    preset: BoardRangePreset
    startDate?: string
    endDate?: string
    includeAnchorLeaderboard?: boolean
    signal?: AbortSignal
  },
): Promise<BoardLiveQueryData> {
  const result = await fetchBoardRangeDataResult(path, params)
  if (result.notModified) {
    throw new Error('收到 304 但调用方未提供缓存')
  }
  return result.data
}

export async function fetchBoardOverview(params: {
  preset: BoardRangePreset
  startDate?: string
  endDate?: string
  signal?: AbortSignal
}): Promise<BoardLiveQueryData> {
  return fetchBoardRangeData('overview-data', params)
}

export async function fetchBoardOverviewResult(params: {
  preset: BoardRangePreset
  startDate?: string
  endDate?: string
  signal?: AbortSignal
  etag?: string
}): Promise<BoardFetchResult> {
  return fetchBoardRangeDataResult('overview-data', params)
}

export async function fetchBoardAnchorsData(params: {
  preset: BoardRangePreset
  startDate?: string
  endDate?: string
  signal?: AbortSignal
}): Promise<BoardLiveQueryData> {
  return fetchBoardRangeData('anchors-data', params)
}

export async function fetchBoardAnchorsDataResult(params: {
  preset: BoardRangePreset
  startDate?: string
  endDate?: string
  signal?: AbortSignal
  etag?: string
}): Promise<BoardFetchResult> {
  return fetchBoardRangeDataResult('anchors-data', params)
}

export async function fetchBoardLocalData(params: {
  preset: BoardRangePreset
  startDate?: string
  endDate?: string
  includeAnchorLeaderboard?: boolean
  signal?: AbortSignal
}): Promise<BoardLiveQueryData> {
  return fetchBoardRangeData('local-data', params)
}

/** @deprecated 使用 fetchBoardLocalData */
export async function runBoardLiveQuery(params: {
  preset: BoardRangePreset
  startDate?: string
  endDate?: string
  pageSize?: number
  signal?: AbortSignal
  onProgress?: (p: LiveQueryProgress) => void
}): Promise<BoardLiveQueryData> {
  if (params.onProgress) {
    params.onProgress({
      totalPages: 1,
      fetchedPages: 0,
      totalOrders: 0,
      message: '正在读取本地同步数据…',
    })
  }
  const result = await fetchBoardLocalData(params)
  if (params.onProgress) {
    params.onProgress(result.progress)
  }
  return result
}

export async function fetchBoardSyncMeta(signal?: AbortSignal): Promise<BoardSyncMeta> {
  return apiRequest<BoardSyncMeta>('/api/board/sync-meta', { signal })
}

export { BUYER_PROFILE_EXPECTED_CACHE_VERSION } from './buyer-profile-cache'

export function isBuyerProfileStatusCacheCompatible(
  status?: BuyerProfileStatus | null,
): boolean {
  if (!status) return true
  if (status.cacheCompatible === false) return false
  const expected = status.expectedCacheVersion ?? BUYER_PROFILE_EXPECTED_CACHE_VERSION
  const version = String(status.cacheVersion ?? '').trim()
  if (!version) return true
  return version === expected
}
