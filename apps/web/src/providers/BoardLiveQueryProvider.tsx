import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation } from 'react-router-dom'
import type { BoardRangePreset } from '../lib/board-range'
import type { BoardResolvedRange } from '../lib/board-live-query'
import { buildBoardQueryKey, buildBoardRangeKey, resolveBoardRangeDates } from '../lib/board-range'
import {
  BOARD_LIVE_QUERY_INVALIDATE_EVENT,
  buildLiveQueryCacheKey,
  invalidateBuyerProfileCache,
  invalidateLiveQueryCacheEntry,
  isLiveQueryCacheFresh,
  readLiveQueryCache,
  readLiveQueryCacheAsync,
  removeLiveQueryCacheEntry,
  resolveCachedBoardIdentity,
  touchLiveQueryCacheTimestamp,
  writeLiveQueryCache,
  type LiveQueryPageScope,
} from '../lib/board-live-query-cache'
import { scheduleBoardStandardPrefetch } from '../lib/board-prefetch'
import { resolveAppPageScope } from '../lib/app-page-scope'
import {
  fetchBoardAnchorsDataResult,
  fetchBoardOverviewResult,
  fetchBoardSyncMeta,
  type BoardActiveSyncJob,
  type BoardLiveQueryData,
  type BoardSyncMeta,
  type BoardDataDisplayStatus,
  type RollingDataHealthCloseSummary,
} from '../lib/board-live-query'
import { apiRequest } from '../lib/api'
import { deriveBoardSyncUiMode, isBusinessSyncActive } from '../lib/business-sync-ui'
import { boardSummaryHasOrderData } from '../lib/board-summary.util'
import type { CookieHealthPayload } from '../lib/live-account'
import type { QualityFeedbackStatus } from '../components/board/OfficialQualitySyncNote'

export type BoardLiveQueryStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface BoardLiveQueryContextValue {
  preset: BoardRangePreset
  customStart: string
  customEnd: string
  customQueried: boolean
  rangeKey: string
  queryKey: string
  setPreset: (p: BoardRangePreset) => void
  setCustomStart: (s: string) => void
  setCustomEnd: (s: string) => void
  setCustomQueried: (q: boolean) => void
  status: BoardLiveQueryStatus
  error: string | null
  data: BoardLiveQueryData | null
  /** 与 data 相同，对应当前 rangeKey 下可展示的本地查询结果 */
  displayData: BoardLiveQueryData | null
  displaySummary: Record<string, unknown> | null
  resolvedRange: BoardResolvedRange
  dataDisplayStatus: BoardDataDisplayStatus | null
  isLoading: boolean
  /** 有缓存时后台刷新中 */
  isRefreshing: boolean
  isDisplayStale: boolean
  boardSyncUiMode: ReturnType<typeof deriveBoardSyncUiMode>
  lastSyncedAt: string | null
  syncMeta: BoardSyncMeta | null
  activeSyncJob: BoardActiveSyncJob | null
  totalRawOrders: number
  totalRawLiveSessions: number
  totalAfterSaleRecords: number
  totalQualityCases: number
  rollingDataHealthClose: RollingDataHealthCloseSummary | null
  pageFetchedAt: string | null
  cookieHealth: CookieHealthPayload | null
  staleMessage: string | null
  startDate: string
  endDate: string
  qualityFeedback: QualityFeedbackStatus | null
  reload: () => Promise<void>
  /** 清除当前范围浏览器缓存后无 ETag 重拉（不触发平台同步） */
  reloadLocalFresh: () => Promise<void>
  triggerBusinessSync: () => Promise<void>
  triggerSyncBusy: boolean
}

const BoardLiveQueryContext = createContext<BoardLiveQueryContextValue | null>(null)

function resolveDisplaySummary(cached: BoardLiveQueryData): Record<string, unknown> | null {
  const rawCachedSummary =
    Object.keys(cached.summary ?? {}).length > 0 ? cached.summary : null
  if (
    rawCachedSummary &&
    (cached.dataDisplayStatus !== 'empty' || boardSummaryHasOrderData(rawCachedSummary))
  ) {
    return rawCachedSummary
  }
  return boardSummaryHasOrderData(rawCachedSummary) ? rawCachedSummary : null
}

function isCachedPayloadUsable(data: BoardLiveQueryData | null | undefined): boolean {
  if (!data) return false
  if (!data.preset || !data.startDate || !data.endDate) return false
  if (!data.summary || typeof data.summary !== 'object') return false
  return true
}

function resolveCachedRangeKey(cached: BoardLiveQueryData): string {
  return (
    cached.rangeKey ??
    buildBoardRangeKey(
      cached.preset as BoardRangePreset,
      cached.startDate,
      cached.endDate,
    )
  )
}

export const BoardLiveQueryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const location = useLocation()
  const appPage = resolveAppPageScope(location.pathname)
  const pageScope: LiveQueryPageScope | null =
    appPage === 'anchors' ? 'anchors' : appPage === 'overview' ? 'overview' : null
  const shouldLoadBoardData = pageScope != null

  const [preset, setPreset] = useState<BoardRangePreset>('thisMonth')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [customQueried, setCustomQueried] = useState(false)
  const [status, setStatus] = useState<BoardLiveQueryStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BoardLiveQueryData | null>(null)
  const [displaySummary, setDisplaySummary] = useState<Record<string, unknown> | null>(null)
  const [dataDisplayStatus, setDataDisplayStatus] = useState<BoardDataDisplayStatus | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncMeta, setSyncMeta] = useState<BoardSyncMeta | null>(null)
  const [staleMessage, setStaleMessage] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [triggerSyncBusy, setTriggerSyncBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)
  const currentQueryKeyRef = useRef('')
  const hasLoadedOnceRef = useRef(false)
  const wasSyncingRef = useRef(false)
  const lastSeenSuccessAtRef = useRef<string | null>(null)
  const lastSeenFinishedJobIdRef = useRef<string | null>(null)
  const refreshInFlightRef = useRef(false)
  const skipEtagOnceRef = useRef(false)

  const { startDate, endDate } = useMemo(
    () => resolveBoardRangeDates(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  )

  const rangeKey = useMemo(
    () => buildBoardRangeKey(preset, startDate, endDate),
    [preset, startDate, endDate],
  )

  const queryKey = useMemo(() => {
    if (!pageScope) return ''
    return buildBoardQueryKey({ pageScope, preset, startDate, endDate })
  }, [pageScope, preset, startDate, endDate])

  currentQueryKeyRef.current = queryKey

  const loadedQueryKey = data?.queryKey ?? null
  const queryMatched = Boolean(queryKey) && loadedQueryKey === queryKey
  const isDisplayStale = Boolean(
    displaySummary && loadedQueryKey && loadedQueryKey !== queryKey,
  )

  const activeSyncJob = syncMeta?.activeSyncJob ?? null
  const totalRawOrders = syncMeta?.totalRawOrders ?? 0
  const totalRawLiveSessions = syncMeta?.totalRawLiveSessions ?? 0
  const totalAfterSaleRecords = syncMeta?.totalAfterSaleRecords ?? 0
  const totalQualityCases = syncMeta?.totalQualityCases ?? 0
  const rollingDataHealthClose = syncMeta?.rollingDataHealthClose ?? null
  const pageFetchedAt = queryMatched ? data?.fetchedAt ?? null : null

  /** 仅当 loadedQueryKey 与当前 queryKey 一致时，才向 UI 暴露 summary / data */
  const showSummaryForUi = queryMatched ? displaySummary : null
  const showDataForUi = queryMatched ? data : null

  const boardSyncUiMode = deriveBoardSyncUiMode({
    hasDisplayData: Boolean(showSummaryForUi),
    businessSync: syncMeta?.businessSync,
    activeSyncJob,
    totalRawOrders,
    isLoadingRange: !queryMatched && status === 'loading',
  })

  const qualityFeedback = queryMatched ? data?.qualityFeedback ?? null : null

  const applyCachedBoardResult = useCallback(
    (params: {
      cached: BoardLiveQueryData
      expectedRangeKey: string
      expectedQueryKey: string
      expectedPageScope: LiveQueryPageScope
      refreshing?: boolean
    }) => {
      const {
        cached,
        expectedRangeKey,
        expectedQueryKey,
        expectedPageScope,
        refreshing = false,
      } = params
      const summary = resolveDisplaySummary(cached)
      setData({
        ...cached,
        rangeKey: expectedRangeKey,
        queryKey: expectedQueryKey,
        pageScope: expectedPageScope,
      })
      setDisplaySummary(summary)
      setDataDisplayStatus(cached.dataDisplayStatus ?? null)
      if (cached.syncMeta) setSyncMeta(cached.syncMeta)
      setLastSyncedAt(
        cached.overviewMeta?.lastQianfanSyncAt ??
          cached.syncMeta?.businessSync.lastSuccessAt ??
          cached.fetchedAt,
      )
      setStatus('ready')
      setError(null)
      setIsRefreshing(refreshing)
      hasLoadedOnceRef.current = true
    },
    [],
  )

  const applyStaleMessage = useCallback(
    (
      meta: BoardSyncMeta | null,
      displayStatus: BoardDataDisplayStatus | null | undefined,
      result: BoardLiveQueryData,
      summary: Record<string, unknown> | null,
    ) => {
      if (result.overviewMeta?.cacheStale || result.overviewMeta?.fallbackReason) {
        setStaleMessage('缓存重建失败，当前展示上一次成功数据。')
        return
      }
      const uiMode = deriveBoardSyncUiMode({
        hasDisplayData: Boolean(summary),
        businessSync: meta?.businessSync ?? result.syncMeta?.businessSync,
        activeSyncJob: meta?.activeSyncJob,
        totalRawOrders: meta?.totalRawOrders ?? 0,
      })

      if (uiMode === 'first_sync' || uiMode === 'empty_idle' || uiMode === 'syncing_with_data') {
        setStaleMessage(null)
        return
      }
      if (displayStatus === 'failed_with_cache') {
        setStaleMessage('本次更新失败，当前展示上一次成功数据。')
        return
      }
      if (displayStatus === 'coverage_missing' || result.rangeCoverage?.status === 'not_covered') {
        const names = (result.rangeCoverage?.missingShopNames ?? []).filter(Boolean)
        setStaleMessage(
          names.length > 0
            ? `部分店铺尚未完成该日期范围同步。尚未覆盖：${names.join('、')}`
            : '部分店铺尚未完成该日期范围同步',
        )
        return
      }
      if (displayStatus === 'empty' && result.rangeCoverage?.status === 'unknown') {
        setStaleMessage('暂未查询到数据，系统正在确认各店铺同步状态')
        return
      }
      if (displayStatus === 'empty') {
        setStaleMessage('当前日期范围内暂无订单数据')
        return
      }
      if (displayStatus === 'syncing_no_cache' || displayStatus === 'syncing_with_cache') {
        setStaleMessage(
          result.progress?.message ??
            (result.rangeCoverage?.status === 'syncing'
              ? '部分店铺数据正在同步'
              : '数据正在准备中'),
        )
        return
      }
      setStaleMessage(null)
    },
    [],
  )

  const refreshSyncMeta = useCallback(async () => {
    try {
      const meta = await fetchBoardSyncMeta()
      setSyncMeta(meta)
      return meta
    } catch {
      return null
    }
  }, [])

  const loadLocal = useCallback(async () => {
    if (!shouldLoadBoardData || !pageScope) {
      return
    }
    if (preset === 'custom' && (!customQueried || !customStart || !customEnd)) {
      setStatus('idle')
      setData(null)
      setDisplaySummary(null)
      setDataDisplayStatus(null)
      setStaleMessage(null)
      setError(null)
      setIsRefreshing(false)
      return
    }

    const fetchRangeKey = buildBoardRangeKey(preset, startDate, endDate)
    const fetchQueryKey = buildBoardQueryKey({ pageScope, preset, startDate, endDate })
    const seq = ++requestSeqRef.current
    currentQueryKeyRef.current = fetchQueryKey

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // 切换 pageScope/日期：先清掉旧页面文案，避免串页
    setStaleMessage(null)
    setError(null)

    const liveCacheKey = buildLiveQueryCacheKey({
      pageScope,
      preset,
      startDate,
      endDate,
    })
    const cachedEntry =
      (await readLiveQueryCacheAsync(liveCacheKey)) ?? readLiveQueryCache(liveCacheKey)
    const identityCached =
      cachedEntry?.data &&
      resolveCachedBoardIdentity({
        data: cachedEntry.data,
        cacheKey: liveCacheKey,
        expectedPageScope: pageScope,
        expectedQueryKey: fetchQueryKey,
      })
    const cachedRangeKey = identityCached ? resolveCachedRangeKey(identityCached) : null
    const payloadUsable = isCachedPayloadUsable(identityCached)
    const hasFreshCache =
      Boolean(
        identityCached &&
          payloadUsable &&
          cachedEntry &&
          isLiveQueryCacheFresh(cachedEntry, Date.now(), preset) &&
          cachedRangeKey === fetchRangeKey,
      )

    // 无本页新鲜缓存：骨架屏，不沿用另一页面的 coverage/empty/error
    if (!hasFreshCache) {
      setData(null)
      setDisplaySummary(null)
      setDataDisplayStatus(null)
      setStatus('loading')
      setIsRefreshing(false)
    } else if (identityCached) {
      applyCachedBoardResult({
        cached: identityCached,
        expectedRangeKey: fetchRangeKey,
        expectedQueryKey: fetchQueryKey,
        expectedPageScope: pageScope,
        refreshing: true,
      })
    }

    const skipEtag = skipEtagOnceRef.current
    skipEtagOnceRef.current = false
    const canRevalidateWithEtag =
      !skipEtag &&
      Boolean(cachedEntry?.etag) &&
      Boolean(identityCached) &&
      cachedRangeKey === fetchRangeKey &&
      payloadUsable

    const fetchBoard =
      pageScope === 'anchors' ? fetchBoardAnchorsDataResult : fetchBoardOverviewResult

    const isStaleRequest = () =>
      controller.signal.aborted ||
      seq !== requestSeqRef.current ||
      fetchQueryKey !== currentQueryKeyRef.current

    try {
      let fetchResult = await fetchBoard({
        preset,
        startDate,
        endDate,
        signal: controller.signal,
        etag: canRevalidateWithEtag ? cachedEntry?.etag : undefined,
      })

      if (isStaleRequest()) return

      if (fetchResult.notModified) {
        if (identityCached && payloadUsable && cachedRangeKey === fetchRangeKey) {
          applyCachedBoardResult({
            cached: identityCached,
            expectedRangeKey: fetchRangeKey,
            expectedQueryKey: fetchQueryKey,
            expectedPageScope: pageScope,
            refreshing: false,
          })
          touchLiveQueryCacheTimestamp(liveCacheKey)
          applyStaleMessage(
            identityCached.syncMeta ?? null,
            identityCached.dataDisplayStatus,
            identityCached,
            resolveDisplaySummary(identityCached),
          )
          scheduleBoardStandardPrefetch({ preferScope: pageScope })
          return
        }

        // 304 但 pageScope/queryKey 不匹配或本地不可恢复：清条目后无 ETag 补发
        removeLiveQueryCacheEntry(liveCacheKey)
        if (skipEtag) {
          setError('本地缓存无法恢复，请重新加载')
          setStatus('failed')
          setIsRefreshing(false)
          setStaleMessage('缓存恢复失败，请重新加载本地结果')
          return
        }
        fetchResult = await fetchBoard({
          preset,
          startDate,
          endDate,
          signal: controller.signal,
        })
        if (isStaleRequest()) return
        if (fetchResult.notModified) {
          setError('本地缓存无法恢复，请重新加载')
          setStatus('failed')
          setIsRefreshing(false)
          return
        }
      }

      const result = fetchResult.data
      if (!result) {
        setError('看板数据为空')
        setStatus('failed')
        setIsRefreshing(false)
        return
      }

      const resultRangeKey =
        result.rangeKey ??
        buildBoardRangeKey(result.preset, result.startDate, result.endDate)
      if (resultRangeKey !== fetchRangeKey) {
        setError(
          `返回数据范围（${resultRangeKey}）与当前统计范围（${fetchRangeKey}）不一致，请重试。`,
        )
        setStatus('failed')
        return
      }

      if (isStaleRequest()) return

      hasLoadedOnceRef.current = true
      const enriched: BoardLiveQueryData = {
        ...result,
        rangeKey: resultRangeKey,
        queryKey: fetchQueryKey,
        pageScope,
      }
      const summary = resolveDisplaySummary(enriched)
      setData(enriched)
      setDisplaySummary(summary)
      setDataDisplayStatus(result.dataDisplayStatus ?? null)
      if (result.syncMeta) {
        setSyncMeta(result.syncMeta)
      }
      writeLiveQueryCache(liveCacheKey, enriched, {
        etag: fetchResult.etag,
        dataGeneration: fetchResult.dataGeneration,
      })
      setLastSyncedAt(
        result.overviewMeta?.lastQianfanSyncAt ??
          result.syncMeta?.businessSync.lastSuccessAt ??
          result.fetchedAt,
      )
      scheduleBoardStandardPrefetch({ preferScope: pageScope })
      applyStaleMessage(result.syncMeta ?? null, result.dataDisplayStatus, enriched, summary)
      setStatus('ready')
      setError(null)
      setIsRefreshing(false)
    } catch (e) {
      if (isStaleRequest()) return
      const msg = e instanceof Error ? e.message : '加载失败'
      setError(msg)
      setStatus('failed')
      setIsRefreshing(false)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [
    preset,
    customQueried,
    customStart,
    customEnd,
    startDate,
    endDate,
    pageScope,
    shouldLoadBoardData,
    applyCachedBoardResult,
    applyStaleMessage,
  ])

  const reloadLocalFresh = useCallback(async () => {
    if (!pageScope) return
    invalidateLiveQueryCacheEntry({
      pageScope,
      preset,
      startDate,
      endDate,
    })
    skipEtagOnceRef.current = true
    await loadLocal()
  }, [pageScope, preset, startDate, endDate, loadLocal])

  useEffect(() => {
    void refreshSyncMeta()
  }, [refreshSyncMeta])

  const triggerBusinessSync = useCallback(async () => {
    setTriggerSyncBusy(true)
    try {
      await apiRequest<{ message?: string }>(
        '/api/settings/data-maintenance/trigger-business-sync',
        { method: 'POST' },
      )
      await refreshSyncMeta()
    } finally {
      setTriggerSyncBusy(false)
    }
  }, [refreshSyncMeta])

  useEffect(() => {
    if (!shouldLoadBoardData) return
    void loadLocal()
  }, [loadLocal, queryKey, shouldLoadBoardData])

  useEffect(() => {
    const onInvalidate = () => {
      void loadLocal()
    }
    window.addEventListener(BOARD_LIVE_QUERY_INVALIDATE_EVENT, onInvalidate)
    return () => window.removeEventListener(BOARD_LIVE_QUERY_INVALIDATE_EVENT, onInvalidate)
  }, [loadLocal])

  useEffect(() => {
    const onCleared = () => {
      setData(null)
      setDisplaySummary(null)
      setDataDisplayStatus(null)
      setStaleMessage(null)
      hasLoadedOnceRef.current = false
      void refreshSyncMeta()
      void loadLocal()
    }
    window.addEventListener('business-data-cleared', onCleared)
    return () => window.removeEventListener('business-data-cleared', onCleared)
  }, [loadLocal, refreshSyncMeta])

  useEffect(() => {
    const biz = syncMeta?.businessSync
    const syncing = isBusinessSyncActive(biz?.status)
    const intervalMs = syncing ? 5000 : 60_000

    const maybeReloadAfterSyncChange = (meta: BoardSyncMeta) => {
      const stillSyncing = isBusinessSyncActive(meta.businessSync.status)
      const syncJustFinished = wasSyncingRef.current && !stillSyncing
      wasSyncingRef.current = stillSyncing

      const successAt = meta.businessSync.lastSuccessAt ?? null
      const finishedJobId = meta.activeSyncJob?.id ?? null
      const successChanged =
        Boolean(successAt) && successAt !== lastSeenSuccessAtRef.current
      const jobChanged =
        Boolean(finishedJobId) &&
        !stillSyncing &&
        finishedJobId !== lastSeenFinishedJobIdRef.current

      if (!syncJustFinished && !successChanged && !jobChanged) return
      if (refreshInFlightRef.current) return

      if (successAt) lastSeenSuccessAtRef.current = successAt
      if (finishedJobId && !stillSyncing) {
        lastSeenFinishedJobIdRef.current = finishedJobId
      }

      refreshInFlightRef.current = true
      void loadLocal()
        .then(() => {
          invalidateBuyerProfileCache('business-sync-finished')
        })
        .finally(() => {
          refreshInFlightRef.current = false
        })
    }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const meta = await refreshSyncMeta()
          if (!meta) return
          maybeReloadAfterSyncChange(meta)
        } catch {
          /* ignore */
        }
      })()
    }, intervalMs)

    wasSyncingRef.current = syncing
    if (biz?.lastSuccessAt && !lastSeenSuccessAtRef.current) {
      lastSeenSuccessAtRef.current = biz.lastSuccessAt
    }

    return () => window.clearInterval(timer)
  }, [
    syncMeta?.businessSync.status,
    syncMeta?.businessSync.lastSuccessAt,
    syncMeta?.businessSync.currentTask,
    syncMeta?.activeSyncJob,
    loadLocal,
    refreshSyncMeta,
  ])

  const resolvedRange = useMemo<BoardResolvedRange>(() => {
    if (queryMatched && data?.resolvedRange) {
      return data.resolvedRange
    }
    return { preset, startDate, endDate }
  }, [queryMatched, data?.resolvedRange, preset, startDate, endDate])

  const value = useMemo(
    () => ({
      preset,
      customStart,
      customEnd,
      customQueried,
      rangeKey,
      queryKey,
      setPreset,
      setCustomStart,
      setCustomEnd,
      setCustomQueried,
      status,
      error: queryMatched ? error : null,
      data: showDataForUi,
      displayData: showDataForUi,
      displaySummary: showSummaryForUi,
      resolvedRange,
      dataDisplayStatus: queryMatched ? dataDisplayStatus : null,
      isLoading: status === 'loading' && !showSummaryForUi,
      isRefreshing: queryMatched ? isRefreshing : false,
      isDisplayStale,
      boardSyncUiMode,
      lastSyncedAt,
      syncMeta,
      activeSyncJob,
      totalRawOrders,
      totalRawLiveSessions,
      totalAfterSaleRecords,
      totalQualityCases,
      rollingDataHealthClose,
      pageFetchedAt,
      cookieHealth: syncMeta?.cookieHealth ?? null,
      staleMessage: queryMatched ? staleMessage : null,
      startDate,
      endDate,
      qualityFeedback,
      reload: loadLocal,
      reloadLocalFresh,
      triggerBusinessSync,
      triggerSyncBusy,
    }),
    [
      preset,
      customStart,
      customEnd,
      customQueried,
      rangeKey,
      queryKey,
      status,
      error,
      showDataForUi,
      showSummaryForUi,
      resolvedRange,
      dataDisplayStatus,
      isDisplayStale,
      boardSyncUiMode,
      lastSyncedAt,
      syncMeta,
      activeSyncJob,
      totalRawOrders,
      totalRawLiveSessions,
      totalAfterSaleRecords,
      totalQualityCases,
      rollingDataHealthClose,
      pageFetchedAt,
      staleMessage,
      isRefreshing,
      startDate,
      endDate,
      qualityFeedback,
      loadLocal,
      reloadLocalFresh,
      triggerBusinessSync,
      triggerSyncBusy,
      queryMatched,
    ],
  )

  return (
    <BoardLiveQueryContext.Provider value={value}>{children}</BoardLiveQueryContext.Provider>
  )
}

export function useBoardLiveQuery(): BoardLiveQueryContextValue {
  const ctx = useContext(BoardLiveQueryContext)
  if (!ctx) {
    throw new Error('useBoardLiveQuery must be used within BoardLiveQueryProvider')
  }
  return ctx
}

export const BoardLiveQueryAutoRefresh: React.FC<{ pageScope?: string }> = () => null
