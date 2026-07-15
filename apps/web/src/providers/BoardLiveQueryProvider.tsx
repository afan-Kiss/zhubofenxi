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
import { buildBoardRangeKey, resolveBoardRangeDates } from '../lib/board-range'
import {
  BOARD_LIVE_QUERY_INVALIDATE_EVENT,
  buildLiveQueryCacheKey,
  invalidateBuyerProfileCache,
  isLiveQueryCacheFresh,
  readLiveQueryCache,
  readLiveQueryCacheAsync,
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
  triggerBusinessSync: () => Promise<void>
  triggerSyncBusy: boolean
}

const BoardLiveQueryContext = createContext<BoardLiveQueryContextValue | null>(null)

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
  const hasLoadedOnceRef = useRef(false)
  const wasSyncingRef = useRef(false)

  const { startDate, endDate } = useMemo(
    () => resolveBoardRangeDates(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  )

  const rangeKey = useMemo(
    () => buildBoardRangeKey(preset, startDate, endDate),
    [preset, startDate, endDate],
  )

  const loadedRangeKey = data?.rangeKey ?? null
  const rangeMatched = loadedRangeKey === rangeKey
  const isDisplayStale = Boolean(
    displaySummary && loadedRangeKey && loadedRangeKey !== rangeKey,
  )

  const activeSyncJob = syncMeta?.activeSyncJob ?? null
  const totalRawOrders = syncMeta?.totalRawOrders ?? 0
  const totalRawLiveSessions = syncMeta?.totalRawLiveSessions ?? 0
  const totalAfterSaleRecords = syncMeta?.totalAfterSaleRecords ?? 0
  const totalQualityCases = syncMeta?.totalQualityCases ?? 0
  const rollingDataHealthClose = syncMeta?.rollingDataHealthClose ?? null
  const pageFetchedAt = rangeMatched ? data?.fetchedAt ?? null : null

  /** 仅当 loadedRangeKey 与当前 rangeKey 一致时，才向 UI 暴露 summary / data */
  const showSummaryForUi = rangeMatched ? displaySummary : null
  const showDataForUi = rangeMatched ? data : null

  const boardSyncUiMode = deriveBoardSyncUiMode({
    hasDisplayData: Boolean(showSummaryForUi),
    businessSync: syncMeta?.businessSync,
    activeSyncJob,
    totalRawOrders,
    isLoadingRange: !rangeMatched && status === 'loading',
  })

  const qualityFeedback = rangeMatched ? data?.qualityFeedback ?? null : null

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
      return
    }

    const fetchRangeKey = buildBoardRangeKey(preset, startDate, endDate)
    const seq = ++requestSeqRef.current

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStaleMessage(null)

    const liveCacheKey = buildLiveQueryCacheKey({
      pageScope,
      preset,
      startDate,
      endDate,
    })
    const cachedEntry =
      (await readLiveQueryCacheAsync(liveCacheKey)) ?? readLiveQueryCache(liveCacheKey)
    const cachedRangeKey =
      cachedEntry?.data?.rangeKey ??
      (cachedEntry?.data
        ? buildBoardRangeKey(
            cachedEntry.data.preset as BoardRangePreset,
            cachedEntry.data.startDate,
            cachedEntry.data.endDate,
          )
        : null)
    const hasFreshCache =
      Boolean(
        cachedEntry &&
          isLiveQueryCacheFresh(cachedEntry, Date.now(), preset) &&
          cachedRangeKey === fetchRangeKey &&
          Object.keys(cachedEntry.data.summary ?? {}).length > 0,
      )

    if (hasFreshCache && cachedEntry) {
      const cached = cachedEntry.data
      const rawCachedSummary =
        Object.keys(cached.summary ?? {}).length > 0 ? cached.summary : null
      const summary =
        rawCachedSummary &&
        (cached.dataDisplayStatus !== 'empty' || boardSummaryHasOrderData(rawCachedSummary))
          ? rawCachedSummary
          : boardSummaryHasOrderData(rawCachedSummary)
            ? rawCachedSummary
            : null
      setData({ ...cached, rangeKey: fetchRangeKey })
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
      setIsRefreshing(true)
      hasLoadedOnceRef.current = true
    } else {
      setStatus('loading')
      setError(null)
      setIsRefreshing(false)
    }

    try {
      const fetchBoard =
        pageScope === 'anchors' ? fetchBoardAnchorsDataResult : fetchBoardOverviewResult
      const fetchResult = await fetchBoard({
        preset,
        startDate,
        endDate,
        signal: controller.signal,
        etag: cachedEntry?.etag,
      })
      if (controller.signal.aborted || seq !== requestSeqRef.current) return

      if (fetchResult.notModified && cachedEntry?.data) {
        touchLiveQueryCacheTimestamp(liveCacheKey)
        setIsRefreshing(false)
        setStatus('ready')
        scheduleBoardStandardPrefetch({ preferScope: pageScope })
        return
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

      hasLoadedOnceRef.current = true

      const rawSummary =
        Object.keys(result.summary).length > 0 ? result.summary : null
      const summary =
        rawSummary &&
        (result.dataDisplayStatus !== 'empty' || boardSummaryHasOrderData(rawSummary))
          ? rawSummary
          : boardSummaryHasOrderData(rawSummary)
            ? rawSummary
            : null

      setData({ ...result, rangeKey: resultRangeKey })
      setDisplaySummary(summary)
      setDataDisplayStatus(result.dataDisplayStatus ?? null)
      if (result.syncMeta) {
        setSyncMeta(result.syncMeta)
      }
      writeLiveQueryCache(liveCacheKey, { ...result, rangeKey: resultRangeKey }, {
        etag: fetchResult.etag,
        dataGeneration: fetchResult.dataGeneration,
      })
      setLastSyncedAt(
        result.overviewMeta?.lastQianfanSyncAt ??
          result.syncMeta?.businessSync.lastSuccessAt ??
          result.fetchedAt,
      )
      scheduleBoardStandardPrefetch({ preferScope: pageScope })

      const applyStaleMessage = (
        meta: BoardSyncMeta | null,
        displayStatus: BoardDataDisplayStatus | null | undefined,
        progressMessage?: string,
        overviewMetaStale?: boolean,
        overviewFallback?: string | null,
      ) => {
        if (overviewMetaStale || overviewFallback) {
          setStaleMessage('缓存重建失败，当前展示上一次成功数据。')
          return
        }
        const uiMode = deriveBoardSyncUiMode({
          hasDisplayData: Boolean(summary),
          businessSync: meta?.businessSync ?? result.syncMeta?.businessSync,
          activeSyncJob: meta?.activeSyncJob,
          totalRawOrders: meta?.totalRawOrders ?? 0,
        })

        if (uiMode === 'first_sync' || uiMode === 'empty_idle') {
          setStaleMessage(null)
        } else if (uiMode === 'syncing_with_data') {
          setStaleMessage(null)
        } else if (displayStatus === 'failed_with_cache') {
          setStaleMessage('本次更新失败，当前展示上一次成功数据。')
        } else if (displayStatus === 'coverage_missing') {
          setStaleMessage('该日期范围本地数据尚未准备完整，请稍后重试或触发同步。')
        } else if (displayStatus === 'empty') {
          setStaleMessage('当前日期范围内暂无订单。')
        } else {
          setStaleMessage(null)
        }
      }

      applyStaleMessage(
        result.syncMeta ?? null,
        result.dataDisplayStatus,
        result.progress.message,
        result.overviewMeta?.cacheStale,
        result.overviewMeta?.fallbackReason,
      )
      setStatus('ready')
      setError(null)
      setIsRefreshing(false)
    } catch (e) {
      if (controller.signal.aborted || seq !== requestSeqRef.current) return
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
  ])

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
  }, [loadLocal, rangeKey, shouldLoadBoardData])

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
    const hasData = Boolean(displaySummary)
    const intervalMs = syncing ? 5000 : 60_000

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const meta = await refreshSyncMeta()
          if (!meta) return
          const stillSyncing = isBusinessSyncActive(meta.businessSync.status)
          const syncJustFinished = wasSyncingRef.current && !stillSyncing
          wasSyncingRef.current = stillSyncing
          if (syncJustFinished) {
            void loadLocal()
            invalidateBuyerProfileCache('business-sync-finished')
          }
        } catch {
          /* ignore */
        }
      })()
    }, intervalMs)

    wasSyncingRef.current = syncing

    return () => window.clearInterval(timer)
  }, [
    syncMeta?.businessSync.status,
    syncMeta?.businessSync.currentTask,
    syncMeta?.activeSyncJob,
    Boolean(displaySummary),
    loadLocal,
    refreshSyncMeta,
  ])

  const resolvedRange = useMemo<BoardResolvedRange>(() => {
    if (loadedRangeKey === rangeKey && data?.resolvedRange) {
      return data.resolvedRange
    }
    return { preset, startDate, endDate }
  }, [loadedRangeKey, rangeKey, data?.resolvedRange, preset, startDate, endDate])

  const value = useMemo(
    () => ({
      preset,
      customStart,
      customEnd,
      customQueried,
      rangeKey,
      setPreset,
      setCustomStart,
      setCustomEnd,
      setCustomQueried,
      status,
      error,
      data: showDataForUi,
      displayData: showDataForUi,
      displaySummary: showSummaryForUi,
      resolvedRange,
      dataDisplayStatus: rangeMatched ? dataDisplayStatus : null,
      isLoading: status === 'loading' && !showSummaryForUi,
      isRefreshing,
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
      staleMessage,
      startDate,
      endDate,
      qualityFeedback,
      reload: loadLocal,
      triggerBusinessSync,
      triggerSyncBusy,
    }),
    [
      preset,
      customStart,
      customEnd,
      customQueried,
      rangeKey,
      status,
      error,
      showDataForUi,
      loadedRangeKey,
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
      triggerBusinessSync,
      triggerSyncBusy,
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
