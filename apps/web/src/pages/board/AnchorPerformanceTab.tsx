import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronDown, Package, PackageCheck, Percent, RotateCcw, TrendingUp, Undo2, Wallet, AlertTriangle, type LucideIcon } from 'lucide-react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { RangeBar } from '../../components/board/RangeBar'
import { BoardStatRangeNote } from '../../components/board/BoardStatRangeNote'
import { AnimatedStatValue } from '../../components/board/AnimatedStatValue'
import { BoardSummaryMetricCard, type BoardSummaryMetricTone } from '../../components/board/BoardSummaryMetricCard'
import { AnchorOrderDrawer } from '../../components/board/AnchorOrderDrawer'
import { AnchorQualityRefundDrawer } from '../../components/board/AnchorQualityRefundDrawer'
import { AnchorLeaderboardPanel } from '../../components/board/AnchorLeaderboardPanel'
import { AnchorPocketSummaryPanel } from '../../components/board/AnchorPocketSummaryPanel'
import { AnchorAuditExportPanel } from '../../components/board/AnchorAuditExportPanel'
import { MetricStatLabel } from '../../components/board/MetricStatLabel'
import { BusinessSyncProgressCard } from '../../components/board/BusinessSyncProgressCard'
import { resolveProgressCardVariant, isBusinessSyncActive } from '../../lib/business-sync-ui'
import { CookieHealthBanner } from '../../components/board/CookieHealthBanner'
import {
  anchorRowRate,
  isSingleDayPreset,
  aggregateSummaryFromAnchorRows,
  sortAnchorLeaderboardByPerformance,
} from '../../lib/anchor-leaderboard-row'
import {
  BoardLiveQueryAutoRefresh,
  useBoardLiveQuery,
} from '../../providers/BoardLiveQueryProvider'
import { showLongPeriodRates } from '../../lib/board-rate-display'
import { boardSummaryHasOrderData } from '../../lib/board-summary.util'
import { rangeIncludesOfflineGmvSurface } from '../../lib/offline-gmv-range'
import { MetricGridTransition, StaggerCard } from '../../components/ui/MetricGridTransition'
import { DailyReportPreviewButton, prefetchShipmentPhotoDataUrls } from '../../components/board/DailyReportPreviewButton'
import {
  DailyReportShipmentPhotos,
  type DailyReportImageItem,
} from '../../components/board/DailyReportShipmentPhotos'
import { AnchorEffectiveSchedulePanel } from '../../components/board/AnchorEffectiveSchedulePanel'
import {
  BoardMetricDrawer,
  type BoardMetricKey,
} from '../../components/board/BoardMetricDrawer'
import { useDataFreshness } from '../../hooks/useDataFreshness'
import {
  formatBoardDataUpdatedLine,
  formatBoardNextDataUpdateLine,
  resolveBoardDataUpdatedAt,
} from '../../lib/data-freshness'
import type { BoardMetricExplainKey } from '../../lib/metricExplain'
import { apiRequest } from '../../lib/api'
import { OfflineDealEntryPanel } from '../../components/board/OfflineDealEntryPanel'
import { isOfflineOnlyAnchor } from '../../lib/anchor-system-keys'

type AnchorSummaryCardType = 'money' | 'count' | 'rate'

interface AnchorSummaryCardDef {
  label: string
  metricExplainKey: BoardMetricExplainKey
  drawerKey: BoardMetricKey
  type: AnchorSummaryCardType
  tone: BoardSummaryMetricTone
  helper: string
  hint: string
  icon: LucideIcon
  valueKey:
    | 'totalGmv'
    | 'actualSignedAmount'
    | 'orderCount'
    | 'signedOrderCount'
    | 'returnCount'
    | 'returnRate'
    | 'returnAmount'
    | 'returnRefundCount'
    | 'qualityReturnCount'
    | 'signRate'
}

const ANCHOR_SUMMARY_CARDS: AnchorSummaryCardDef[] = [
  {
    label: 'GMV',
    metricExplainKey: 'totalGmv',
    drawerKey: 'gmv',
    type: 'money',
    tone: 'violet',
    helper: '主播归属订单支付金额',
    hint: '查看相关订单',
    icon: TrendingUp,
    valueKey: 'totalGmv',
  },
  {
    label: '已签收金额',
    metricExplainKey: 'actualSignedAmount',
    drawerKey: 'actualSignedAmount',
    type: 'money',
    tone: 'green',
    helper: '已签收/已完成且符合签收规则的订单金额',
    hint: '点击查看明细',
    icon: Wallet,
    valueKey: 'actualSignedAmount',
  },
  {
    label: '支付单数',
    metricExplainKey: 'orderCount',
    drawerKey: 'orderCount',
    type: 'count',
    tone: 'blue',
    helper: '已支付订单笔数',
    hint: '查看相关订单',
    icon: Package,
    valueKey: 'orderCount',
  },
  {
    label: '已签收单数',
    metricExplainKey: 'signedOrderCount',
    drawerKey: 'signedCount',
    type: 'count',
    tone: 'green',
    helper: '与已签收金额同一订单池，按 P 订单号去重',
    hint: '查看相关订单',
    icon: PackageCheck,
    valueKey: 'signedOrderCount',
  },
  {
    label: '退款单数',
    metricExplainKey: 'returnCount',
    drawerKey: 'returnCount',
    type: 'count',
    tone: 'orange',
    helper: '真实商品退款金额>0 的订单数',
    hint: '查看相关订单',
    icon: Undo2,
    valueKey: 'returnCount',
  },
  {
    label: '退款率',
    metricExplainKey: 'returnRate',
    drawerKey: 'returnRate',
    type: 'rate',
    tone: 'orange',
    helper: '退款单数 ÷ 支付单数',
    hint: '点击查看明细',
    icon: Percent,
    valueKey: 'returnRate',
  },
]

const ANCHOR_MORE_SUMMARY_CARDS: AnchorSummaryCardDef[] = [
  {
    label: '退款金额',
    metricExplainKey: 'returnAmount',
    drawerKey: 'returnAmount',
    type: 'money',
    tone: 'rose',
    helper: '本期退款金额合计',
    hint: '点击查看明细',
    icon: RotateCcw,
    valueKey: 'returnAmount',
  },
  {
    label: '退货退款单数',
    metricExplainKey: 'returnCount',
    drawerKey: 'returnRefundCount',
    type: 'count',
    tone: 'amber',
    helper: '退货退款类型订单笔数',
    hint: '点击查看明细',
    icon: Undo2,
    valueKey: 'returnRefundCount',
  },
  {
    label: '品退单数',
    metricExplainKey: 'qualityReturnCount',
    drawerKey: 'qualityReturnCount',
    type: 'count',
    tone: 'rose',
    helper: '官方品退 + 商品质量售后',
    hint: '点击查看明细',
    icon: AlertTriangle,
    valueKey: 'qualityReturnCount',
  },
  {
    label: '签收率',
    metricExplainKey: 'signRate',
    drawerKey: 'signRate',
    type: 'rate',
    tone: 'teal',
    helper: '已签收单数 ÷ 支付单数',
    hint: '点击查看明细',
    icon: Percent,
    valueKey: 'signRate',
  },
]

function anchorSummaryMetricValue(
  cards: Record<string, unknown>,
  metric: BoardMetricKey,
): number {
  switch (metric) {
    case 'gmv':
      return Number(cards.totalGmv ?? cards.gmv ?? 0)
    case 'effectiveGmv':
      return Number(cards.validSalesAmount ?? cards.effectiveGmv ?? 0)
    case 'actualSignedAmount':
      return Number(cards.actualSignedAmount ?? 0)
    case 'orderCount':
      return Number(cards.orderCount ?? cards.paidOrderCount ?? 0)
    case 'signedCount':
      return Number(cards.signedOrderCount ?? cards.actualSignedCount ?? cards.signedCount ?? 0)
    case 'returnCount':
      return Number(cards.returnCount ?? cards.refundOrderCount ?? 0)
    case 'returnAmount':
      return Number(cards.returnAmount ?? cards.refundAmount ?? 0)
    case 'returnRefundCount':
      return Number(cards.returnRefundCount ?? 0)
    case 'qualityReturnCount':
      return Number(cards.qualityReturnCount ?? 0)
    case 'signRate':
      return Number(cards.signRate ?? 0)
    case 'returnRate':
      return Number(cards.returnRate ?? cards.refundRate ?? 0)
    default:
      return 0
  }
}

function anchorCardRawValue(cards: Record<string, unknown>, key: AnchorSummaryCardDef['valueKey']): number {
  if (key === 'totalGmv') return Number(cards.totalGmv ?? cards.gmv ?? 0)
  if (key === 'actualSignedAmount') return Number(cards.actualSignedAmount ?? 0)
  if (key === 'orderCount') return Number(cards.orderCount ?? cards.paidOrderCount ?? 0)
  if (key === 'signedOrderCount') {
    return Number(cards.signedOrderCount ?? cards.actualSignedCount ?? cards.signedCount ?? 0)
  }
  if (key === 'returnCount') return Number(cards.returnCount ?? cards.refundOrderCount ?? 0)
  if (key === 'returnAmount') return Number(cards.returnAmount ?? cards.refundAmount ?? 0)
  if (key === 'returnRefundCount') return Number(cards.returnRefundCount ?? 0)
  if (key === 'qualityReturnCount') return Number(cards.qualityReturnCount ?? 0)
  if (key === 'signRate') return Number(cards.signRate ?? 0)
  return Number(cards.returnRate ?? cards.refundRate ?? 0)
}

export const AnchorPerformanceTab: React.FC = () => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const {
    preset,
    customStart,
    customEnd,
    customQueried,
    setPreset,
    setCustomStart,
    setCustomEnd,
    setCustomQueried,
    data,
    displaySummary,
    status,
    error,
    isLoading,
    isDisplayStale,
    syncMeta,
    cookieHealth,
    dataDisplayStatus,
    startDate,
    endDate,
    resolvedRange,
    reload,
    reloadLocalFresh,
    boardSyncUiMode,
    activeSyncJob,
    totalRawOrders,
    triggerBusinessSync,
    triggerSyncBusy,
  } = useBoardLiveQuery()

  const { data: dataFreshness, loading: dataFreshnessLoading } = useDataFreshness(startDate, endDate)

  const [anchorFilter, setAnchorFilter] = useState('全部')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [anchorDrawer, setAnchorDrawer] = useState<{
    anchorName: string
    anchorId?: string
    rowSnapshot: Record<string, unknown>
  } | null>(null)
  const [qualityDrawer, setQualityDrawer] = useState<{
    anchorName: string
    anchorId?: string
  } | null>(null)
  const [metricDrawer, setMetricDrawer] = useState<BoardMetricKey | null>(null)
  const [moreMetricsOpen, setMoreMetricsOpen] = useState(true)
  const [returnRefundDrawerAnchor, setReturnRefundDrawerAnchor] = useState<{
    anchorName: string
    anchorId?: string
  } | null>(null)
  const [returnCountDrawerAnchor, setReturnCountDrawerAnchor] = useState<{
    anchorName: string
    anchorId?: string
  } | null>(null)
  const [shipmentPhotos, setShipmentPhotos] = useState<DailyReportImageItem[]>([])
  const [shipmentPhotoDataUrls, setShipmentPhotoDataUrls] = useState<Record<string, string>>({})
  const [reportPhotosStale, setReportPhotosStale] = useState(false)
  const handleShipmentImagesChange = useCallback((images: DailyReportImageItem[]) => {
    setShipmentPhotos(images)
    setReportPhotosStale(true)
    void prefetchShipmentPhotoDataUrls(images).then(setShipmentPhotoDataUrls)
  }, [])

  const allAnchors = useMemo(
    () => sortAnchorLeaderboardByPerformance((data?.anchorLeaderboard as Array<Record<string, unknown>>) ?? []),
    [data?.anchorLeaderboard],
  )

  const [configAnchors, setConfigAnchors] = useState<
    Array<{ id: string; name: string; attributionMode?: string; systemKey?: string | null }>
  >([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiRequest<{
          anchors: Array<{
            id: string
            name: string
            attributionMode?: string
            systemKey?: string | null
          }>
          filterNames?: string[]
        }>('/api/anchors/options')
        if (!cancelled) setConfigAnchors(res.anchors ?? [])
      } catch {
        if (!cancelled) setConfigAnchors([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 普通直播主播榜：排除线下专属 YIFAN_MANUAL（勿用展示名判断） */
  const visibleLiveAnchorRows = useMemo(
    () =>
      allAnchors.filter((row) => {
        const rowKey = row.systemKey != null ? String(row.systemKey) : null
        if (isOfflineOnlyAnchor({ systemKey: rowKey })) return false
        const cfg = configAnchors.find(
          (a) => a.id === String(row.anchorId ?? '') || a.name === String(row.anchorName ?? ''),
        )
        return !isOfflineOnlyAnchor({ systemKey: cfg?.systemKey ?? null })
      }),
    [allAnchors, configAnchors],
  )

  const handleOrderAnchorAssigned = useCallback(() => {
    void reload()
  }, [reload])

  const filterOptions = useMemo(() => {
    const byName = new Map<string, { id: string; name: string }>()
    for (const a of configAnchors) {
      if (!a.name.trim()) continue
      if (isOfflineOnlyAnchor({ systemKey: a.systemKey })) continue
      byName.set(a.name, { id: a.id, name: a.name })
    }
    for (const a of visibleLiveAnchorRows) {
      const name = String(a.anchorName ?? '').trim()
      if (!name || name === '未归属') continue
      if (!byName.has(name)) {
        byName.set(name, { id: String(a.anchorId ?? name), name })
      }
    }
    return Array.from(byName.values())
  }, [configAnchors, visibleLiveAnchorRows])

  const options = filterOptions

  const selectedConfigAnchor = useMemo(() => {
    if (anchorFilter === '全部') return null
    return configAnchors.find((a) => a.name === anchorFilter) ?? null
  }, [anchorFilter, configAnchors])

  const selectedIsManual =
    selectedConfigAnchor?.attributionMode === 'manual' ||
    Boolean(selectedConfigAnchor?.systemKey)

  const anchors = useMemo(() => {
    if (anchorFilter === '全部') return visibleLiveAnchorRows
    return visibleLiveAnchorRows.filter(
      (a) => String(a.anchorName) === anchorFilter || String(a.anchorName).includes(anchorFilter),
    )
  }, [visibleLiveAnchorRows, anchorFilter])

  const performanceSummary = data?.anchorPerformanceSummary
  const filteredPerformanceSummary = useMemo(() => {
    if (anchorFilter === '全部') return performanceSummary ?? {}
    return aggregateSummaryFromAnchorRows(anchors)
  }, [anchorFilter, performanceSummary, anchors])
  const selectedAnchorMeta = useMemo(() => {
    if (anchorFilter === '全部') return null
    const row = allAnchors.find((a) => String(a.anchorName) === anchorFilter)
    return {
      anchorName: anchorFilter,
      anchorId:
        anchorFilter === '未归属' ? undefined : String(row?.anchorId ?? '').trim() || undefined,
    }
  }, [anchorFilter, allAnchors])
  const blacklistedBuyerIds = data?.blacklistedBuyerIds ?? []
  const hasPerformanceData =
    boardSummaryHasOrderData(filteredPerformanceSummary as Record<string, unknown>) ||
    (anchorFilter === '全部' && (data?.anchorLeaderboard?.length ?? 0) > 0)
  const cards = filteredPerformanceSummary ?? {}
  /** 总/线上/线下/未归属：必须用后端汇总，禁止对可见主播行求和（否则会丢线下 GMV） */
  const boardGmvSplit = useMemo(() => {
    const src = (performanceSummary ?? displaySummary ?? {}) as Record<string, unknown>
    const showOffline = rangeIncludesOfflineGmvSurface(startDate, endDate)
    const onlineGmv = Number(src.onlineGmv ?? 0)
    const offlineGmv = showOffline ? Number(src.offlineGmv ?? 0) : 0
    const unassignedGmv = Number(src.unassignedGmv ?? 0)
    return {
      totalGmv: showOffline ? Number(src.totalGmv ?? src.gmv ?? 0) : onlineGmv,
      onlineGmv,
      offlineGmv,
      unassignedGmv,
      showOfflineGmv: showOffline,
    }
  }, [performanceSummary, displaySummary, startDate, endDate])
  const showLivePeriod = isSingleDayPreset(preset, startDate, endDate)
  const showRates = showLongPeriodRates(preset, startDate, endDate)
  const boardDataVisible =
    boardSyncUiMode === 'synced_idle' ||
    boardSyncUiMode === 'syncing_with_data' ||
    boardSyncUiMode === 'loading_range'
  const showDailyReportEntry =
    isSingleDayPreset(preset, startDate, endDate) &&
    Boolean(startDate && endDate) &&
    (preset !== 'custom' || customQueried) &&
    boardDataVisible &&
    status !== 'failed'
  const dailyReportDateLabel = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate.trim())
    if (!m) return startDate
    return `${Number(m[2])}月${Number(m[3])}日`
  }, [startDate])
  const isLoadingRange = isDisplayStale && isLoading
  const showInitialSkeleton = isLoading && !hasPerformanceData && !data
  const showMetrics = hasPerformanceData && boardDataVisible

  const isRealtimePreset = preset === 'today' || preset === 'yesterday'
  const isSyncingNow =
    isRealtimePreset &&
    (isBusinessSyncActive(syncMeta?.businessSync?.status) || Boolean(activeSyncJob))

  const dataUpdatedLine = useMemo(() => {
    if (isSyncingNow) return null
    const updatedAt = resolveBoardDataUpdatedAt({
      latestOrderTime: dataFreshness?.latestOrderTime,
      lastSyncAt: syncMeta?.businessSync?.lastSuccessAt ?? dataFreshness?.lastQianfanSyncAt,
      fetchedAt: data?.fetchedAt,
    })
    return formatBoardDataUpdatedLine(updatedAt)
  }, [
    isSyncingNow,
    dataFreshness?.latestOrderTime,
    dataFreshness?.lastQianfanSyncAt,
    syncMeta?.businessSync?.lastSuccessAt,
    data?.fetchedAt,
  ])

  const nextDataUpdateLine = useMemo(() => {
    if (isSyncingNow) return null
    if (syncMeta?.businessSync?.enabled === false) return null
    return formatBoardNextDataUpdateLine(syncMeta?.businessSync?.nextRunAt)
  }, [isSyncingNow, syncMeta?.businessSync?.enabled, syncMeta?.businessSync?.nextRunAt])

  const freshnessLine = dataUpdatedLine

  const summaryTransitionKey = [
    'anchor-summary',
    data?.startDate,
    data?.endDate,
    anchorFilter,
    syncMeta?.businessSync?.lastSuccessAt ?? data?.fetchedAt,
    String(cards.totalGmv ?? cards.gmv ?? ''),
    String(cards.orderCount ?? ''),
  ]
    .filter((v) => v != null && v !== '')
    .join('|')
  const statTransitionKey = summaryTransitionKey
  const anchorTransitionKey = [
    'anchors',
    data?.startDate,
    data?.endDate,
    syncMeta?.businessSync?.lastSuccessAt ?? data?.fetchedAt,
    String(allAnchors.length),
    allAnchors
      .map((a) =>
        `${String(a.anchorId ?? a.anchorName)}:${String(a.orderCount ?? a.periodOrderCount ?? '')}:${String(a.payAmountCent ?? a.totalGmv ?? '')}`,
      )
      .join(','),
  ]
    .filter((v) => v != null && v !== '')
    .join('|')

  const progressVariant = resolveProgressCardVariant({
    hasDisplayData: hasPerformanceData || Boolean(displaySummary),
    businessSync: syncMeta?.businessSync ?? {
      lastRunAt: null,
      lastSuccessAt: null,
      failedAt: null,
      nextRunAt: null,
      status: 'idle',
      intervalMinutes: 180,
      enabled: false,
      message: '',
      lastError: null,
    },
    activeSyncJob: activeSyncJob ?? null,
    totalRawOrders,
  })

  const showProgressCard =
    boardSyncUiMode === 'first_sync' ||
    boardSyncUiMode === 'empty_idle' ||
    boardSyncUiMode === 'empty_failed'

  const showRangeEmptyOnly =
    !hasPerformanceData &&
    boardSyncUiMode === 'synced_idle' &&
    (dataDisplayStatus === 'empty' || dataDisplayStatus === 'ready') &&
    data?.rangeCoverage?.status !== 'unknown' &&
    !showProgressCard

  const showCoverageMissing =
    !hasPerformanceData &&
    (dataDisplayStatus === 'coverage_missing' ||
      data?.rangeCoverage?.status === 'not_covered') &&
    !showProgressCard

  const showCoverageUnknown =
    !hasPerformanceData &&
    dataDisplayStatus === 'empty' &&
    data?.rangeCoverage?.status === 'unknown' &&
    !showProgressCard &&
    !showRangeEmptyOnly

  const renderAnchorCardValue = (card: AnchorSummaryCardDef): React.ReactNode => {
    const className = 'inline-block font-bold tracking-tight text-slate-900'
    if (card.type === 'rate') {
      const rateKey = card.valueKey === 'signRate' ? 'signRate' : 'returnRate'
      if (anchorRowRate(cards, rateKey) == null) {
        return <span className={className}>--</span>
      }
    }
    if (card.valueKey === 'returnRefundCount') {
      const refundOrders = anchorCardRawValue(cards, 'returnCount')
      const returnRefund = anchorCardRawValue(cards, 'returnRefundCount')
      const refundOnly = Number(cards.refundOnlyCount ?? 0)
      const unknown = Number(cards.unknownRefundTypeCount ?? 0)
      const incomplete = Boolean(cards.returnRefundTypeIncomplete)
      if (
        refundOrders > 0 &&
        returnRefund === 0 &&
        refundOnly === 0 &&
        (unknown > 0 || incomplete)
      ) {
        return <span className={className}>—</span>
      }
    }
    const raw = anchorCardRawValue(cards, card.valueKey)
    if (card.type === 'money') {
      return (
        <AnimatedStatValue
          transitionKey={statTransitionKey}
          value={raw}
          format={(v) => formatMoney(v)}
          className={className}
        />
      )
    }
    if (card.type === 'rate') {
      return (
        <AnimatedStatValue
          transitionKey={statTransitionKey}
          value={raw}
          format={(v) => formatRate(v)}
          className={className}
        />
      )
    }
    return (
      <AnimatedStatValue
        transitionKey={statTransitionKey}
        value={raw}
        format={(v) => formatCount(v)}
        className={className}
      />
    )
  }

  return (
    <div className="space-y-4" data-testid="anchor-performance-page">
      <BoardLiveQueryAutoRefresh />
      <CookieHealthBanner cookieHealth={cookieHealth} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">主播业绩</h2>
          <p className="mt-0.5 text-sm text-slate-500">按订单归属汇总各主播经营表现</p>
          {data?.afterSalesCompleteness && data.afterSalesCompleteness.status !== 'complete' ? (
            <p
              className={
                data.afterSalesCompleteness.status === 'blocked' ||
                data.afterSalesCompleteness.status === 'failed'
                  ? 'mt-1 text-xs text-amber-800'
                  : 'mt-1 text-xs text-sky-800'
              }
            >
              当前范围售后补查
              {data.afterSalesCompleteness.status === 'pending'
                ? '进行中'
                : data.afterSalesCompleteness.status === 'partial'
                  ? '部分完成'
                  : data.afterSalesCompleteness.status === 'failed'
                    ? '有失败'
                    : '受阻'}
              ：{data.afterSalesCompleteness.note}
              {data.afterSalesCompleteness.affectedOrderCount
                ? `（受影响 ${data.afterSalesCompleteness.affectedOrderCount} 单）`
                : ''}
            </p>
          ) : null}
          {data?.globalAfterSalesCompleteness?.globalPendingCount &&
          data.globalAfterSalesCompleteness.globalPendingCount > 0 &&
          data?.afterSalesCompleteness?.status === 'complete' ? (
            <p className="mt-0.5 text-[11px] text-slate-500">
              全局另有 {data.globalAfterSalesCompleteness.globalPendingCount} 笔历史待处理
            </p>
          ) : null}
          {selectedIsManual ? (
            <p className="mt-1 text-xs text-indigo-700">
              该主播仅统计订单明细里手动指定的归属，不受场次和排班影响。
            </p>
          ) : null}
          {!dataFreshnessLoading && !isSyncingNow && freshnessLine ? (
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-slate-400">{freshnessLine}</p>
              {nextDataUpdateLine ? (
                <p className="text-xs text-slate-400">{nextDataUpdateLine}</p>
              ) : null}
            </div>
          ) : null}
          {isSyncingNow ? (
            <p className="mt-1 text-xs text-rose-600">
              {preset === 'today' ? '正在更新今日数据…' : '正在更新昨日数据…'}
            </p>
          ) : null}
        </div>
        {(preset === 'today' || preset === 'yesterday') && startDate && !selectedIsManual ? (
          <Link
            to={`/anchor-schedules?date=${encodeURIComponent(startDate)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            data-testid="anchor-schedule-entry"
          >
            <CalendarDays size={16} />
            {preset === 'yesterday' ? '补录昨日排班' : '设置今日排班'}
          </Link>
        ) : null}
      </div>
      <RangeBar
        preset={preset}
        onPreset={(p) => {
          setPreset(p)
          if (p !== 'custom') setCustomQueried(true)
        }}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStart={setCustomStart}
        onCustomEnd={setCustomEnd}
        customQueried={customQueried}
        onQuery={() => setCustomQueried(true)}
        trailing={<OfflineDealEntryPanel onCreated={() => void reload()} />}
      />
      {showMetrics ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(
            [
              { label: '总 GMV', value: boardGmvSplit.totalGmv, clickable: false },
              { label: '线上 GMV', value: boardGmvSplit.onlineGmv, clickable: false },
              ...(boardGmvSplit.showOfflineGmv
                ? [
                    {
                      label: '线下 GMV',
                      value: boardGmvSplit.offlineGmv,
                      clickable: true,
                      helper: '查看逸凡线下成交明细',
                    },
                  ]
                : []),
              { label: '未归属 GMV', value: boardGmvSplit.unassignedGmv, clickable: false },
            ] as Array<{
              label: string
              value: number
              clickable: boolean
              helper?: string
            }>
          ).map((item) =>
            item.clickable ? (
              <button
                key={item.label}
                type="button"
                data-testid="offline-gmv-card"
                aria-label={`线下 GMV ${formatMoney(item.value)}，查看逸凡线下成交明细`}
                onClick={() => {
                  setReturnRefundDrawerAnchor(null)
                  setReturnCountDrawerAnchor(null)
                  setMetricDrawer('offlineGmv')
                }}
                className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-left shadow-sm transition hover:border-rose-200 hover:bg-rose-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                <p className="text-[11px] text-slate-500">{item.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">
                  {formatMoney(item.value)}
                </p>
                {item.helper ? (
                  <p className="mt-0.5 text-[10px] text-rose-600">{item.helper}</p>
                ) : null}
              </button>
            ) : (
              <div
                key={item.label}
                className="rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm"
              >
                <p className="text-[11px] text-slate-500">{item.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">
                  {formatMoney(item.value)}
                </p>
              </div>
            ),
          )}
          <p className="col-span-2 text-[11px] text-slate-400 md:col-span-4">
            {boardGmvSplit.showOfflineGmv
              ? '总 GMV = 线上 + 线下（线下自 2026-07-14 起计入）；未归属已计入总 GMV。线下专属主播请点「线下 GMV」。'
              : '当前区间早于线下 GMV 生效日（2026-07-14），总 GMV = 线上 GMV。'}
          </p>
        </div>
      ) : null}
      {resolvedRange.startDate && resolvedRange.endDate && (
        <BoardStatRangeNote startDate={resolvedRange.startDate} endDate={resolvedRange.endDate} />
      )}

      {showDailyReportEntry ? (
        <>
          <div className="rounded-2xl border border-rose-100/60 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-800">主播日报</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  将生成 {dailyReportDateLabel}（{startDate}）经营日报长图
                </p>
              </div>
            </div>
            <DailyReportPreviewButton
              preset={preset}
              startDate={startDate}
              endDate={endDate}
              disabled={isLoading && !data}
              shipmentPhotos={preset === 'yesterday' ? [] : shipmentPhotos}
              shipmentPhotoDataUrls={preset === 'yesterday' ? {} : shipmentPhotoDataUrls}
              photosStale={preset === 'yesterday' ? false : reportPhotosStale}
              onGenerated={() => setReportPhotosStale(false)}
            />
          </div>
          {preset !== 'yesterday' ? (
            <DailyReportShipmentPhotos
              reportDate={startDate}
              onImagesChange={handleShipmentImagesChange}
            />
          ) : null}
        </>
      ) : null}

      {showProgressCard ? (
        <BusinessSyncProgressCard
          variant={progressVariant}
          job={activeSyncJob}
          lastError={syncMeta?.businessSync.lastError}
          onTriggerSync={() => void triggerBusinessSync()}
          triggerSyncBusy={triggerSyncBusy}
          totalRawOrders={totalRawOrders}
          lastSuccessAt={syncMeta?.businessSync.lastSuccessAt ?? null}
        />
      ) : null}

      {status === 'failed' && !displaySummary && boardSyncUiMode !== 'empty_failed' && (
        <div className="animate-in fade-in rounded-2xl border border-dashed border-red-200 bg-red-50/40 p-8 text-center duration-300">
          <p className="text-sm text-red-800">{error ?? '加载失败'}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-4 text-sm text-rose-600 underline"
          >
            重新加载
          </button>
        </div>
      )}

      {showInitialSkeleton ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[132px] animate-pulse rounded-2xl bg-slate-100/80" />
          ))}
        </div>
      ) : null}

      {showRangeEmptyOnly ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
          <p className="text-sm text-slate-600">当前日期范围内暂无订单数据。</p>
        </div>
      ) : null}

      {showCoverageUnknown ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
          <p className="text-sm text-slate-600">
            暂未查询到数据，请重新加载；系统正在确认同步状态
          </p>
          <button
            type="button"
            onClick={() => void reloadLocalFresh()}
            className="mt-4 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            重新加载
          </button>
        </div>
      ) : null}

      {showCoverageMissing ? (
        <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/60 p-8 text-center">
          <p className="text-sm text-amber-900">该日期范围尚未完成同步</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void reloadLocalFresh()}
              className="rounded-full border border-amber-200 bg-white px-4 py-1.5 text-sm text-amber-900 hover:bg-amber-50"
            >
              重新加载
            </button>
            <button
              type="button"
              disabled={triggerSyncBusy}
              onClick={() => void triggerBusinessSync()}
              className="rounded-full bg-amber-700 px-4 py-1.5 text-sm text-white hover:bg-amber-800 disabled:opacity-60"
            >
              {triggerSyncBusy ? '同步中…' : '触发经营数据同步'}
            </button>
          </div>
        </div>
      ) : null}

      {showMetrics ? (
        <>
          {options.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={anchorFilter}
                onChange={(e) => setAnchorFilter(e.target.value)}
                className="rounded-full border border-rose-100 px-4 py-2 text-sm transition focus:border-rose-300 focus:outline-none"
              >
                <option value="全部">全部主播</option>
                {options.map((o) => (
                  <option key={o.id} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
              {anchorFilter !== '全部' ? (
                <span className="text-sm text-slate-600">当前查看：{anchorFilter}</span>
              ) : null}
            </div>
          ) : null}
          <MetricGridTransition
            transitionKey={summaryTransitionKey}
            loading={isLoadingRange}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {ANCHOR_SUMMARY_CARDS.map((card, index) => {
                const Icon = card.icon
                return (
                  <StaggerCard key={card.label} index={index} className="h-full">
                    <BoardSummaryMetricCard
                      label={
                        <MetricStatLabel label={card.label} metricKey={card.metricExplainKey} />
                      }
                      value={renderAnchorCardValue(card)}
                      helper={card.helper}
                      hint={card.hint}
                      tone={card.tone}
                      icon={Icon}
                      onClick={() => {
                        setReturnRefundDrawerAnchor(null)
                        setReturnCountDrawerAnchor(null)
                        setMetricDrawer(card.drawerKey)
                      }}
                    />
                  </StaggerCard>
                )
              })}
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setMoreMetricsOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-xl border border-rose-100/80 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-rose-50/40"
                aria-expanded={moreMetricsOpen}
              >
                <span>更多指标</span>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition ${moreMetricsOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {moreMetricsOpen ? (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {ANCHOR_MORE_SUMMARY_CARDS.map((card, index) => {
                    const Icon = card.icon
                    return (
                      <StaggerCard key={card.label} index={index + ANCHOR_SUMMARY_CARDS.length} className="h-full">
                        <BoardSummaryMetricCard
                          label={
                            <MetricStatLabel label={card.label} metricKey={card.metricExplainKey} />
                          }
                          value={renderAnchorCardValue(card)}
                          helper={card.helper}
                          hint={card.hint}
                          tone={card.tone}
                          icon={Icon}
                          onClick={() => {
                            setReturnRefundDrawerAnchor(null)
                            setReturnCountDrawerAnchor(null)
                            setMetricDrawer(card.drawerKey)
                          }}
                        />
                      </StaggerCard>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </MetricGridTransition>
          {Boolean(filteredPerformanceSummary?.returnRefundTypeIncomplete) ||
          (Number(filteredPerformanceSummary?.returnCount ?? 0) > 0 &&
            Number(filteredPerformanceSummary?.returnRefundCount ?? 0) === 0 &&
            Number(filteredPerformanceSummary?.refundOnlyCount ?? 0) === 0 &&
            Number(filteredPerformanceSummary?.unknownRefundTypeCount ?? 0) > 0) ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
              {Number(filteredPerformanceSummary?.returnRefundCount ?? 0) > 0
                ? '部分退款单尚未同步售后明细，退货退款/仅退款分类可能仍不完整；「退款单数」仍可参考。'
                : '售后明细尚未完整同步，暂不能区分「退货退款」与「仅退款」。「退款单数」「退款金额」仍可参考；仅「退货退款单数」暂显示为「—」。'}
            </p>
          ) : null}
          <div className="rounded-2xl border border-rose-100/50 bg-white p-4 shadow-sm">
            <MetricGridTransition transitionKey={anchorTransitionKey} loading={isLoadingRange}>
              <AnchorLeaderboardPanel
                rows={anchors}
                compareRows={visibleLiveAnchorRows}
                showLongPeriodRates={showRates}
                showLivePeriod={showLivePeriod}
                includeZeroPerformance={showLivePeriod}
                startDate={startDate}
                endDate={endDate}
                emptyText="当前范围暂无已同步数据"
                onRowClick={(a) => {
                  const name = String(a.anchorName)
                  setAnchorDrawer({
                    anchorName: name,
                    anchorId:
                      name === '未归属' ? undefined : String(a.anchorId ?? '').trim() || undefined,
                    rowSnapshot: a,
                  })
                }}
                onQualityCountClick={(a) => {
                  const name = String(a.anchorName)
                  setQualityDrawer({
                    anchorName: name,
                    anchorId:
                      name === '未归属' ? undefined : String(a.anchorId ?? '').trim() || undefined,
                  })
                }}
                onReturnRefundCountClick={(a) => {
                  const name = String(a.anchorName)
                  setMetricDrawer('returnRefundCount')
                  setReturnCountDrawerAnchor(null)
                  setReturnRefundDrawerAnchor({
                    anchorName: name,
                    anchorId:
                      name === '未归属' ? undefined : String(a.anchorId ?? '').trim() || undefined,
                  })
                }}
                onReturnCountClick={(a) => {
                  const name = String(a.anchorName)
                  setMetricDrawer('returnCount')
                  setReturnRefundDrawerAnchor(null)
                  setReturnCountDrawerAnchor({
                    anchorName: name,
                    anchorId:
                      name === '未归属' ? undefined : String(a.anchorId ?? '').trim() || undefined,
                  })
                }}
              />
            </MetricGridTransition>
          </div>

          {startDate && endDate ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setToolsOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                aria-expanded={toolsOpen}
              >
                <span>更多工具</span>
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-slate-400 transition ${toolsOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {toolsOpen ? (
                <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
                  <AnchorEffectiveSchedulePanel startDate={startDate} endDate={endDate} />
                  <AnchorPocketSummaryPanel preset={preset} startDate={startDate} endDate={endDate} />
                  <AnchorAuditExportPanel startDate={startDate} endDate={endDate} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <AnchorOrderDrawer
        open={anchorDrawer !== null}
        onClose={() => setAnchorDrawer(null)}
        anchorName={anchorDrawer?.anchorName ?? ''}
        anchorId={anchorDrawer?.anchorId}
        preset={preset}
        startDate={startDate}
        endDate={endDate}
        rowSnapshot={anchorDrawer?.rowSnapshot}
        onOrderAnchorAssigned={handleOrderAnchorAssigned}
      />

      <AnchorQualityRefundDrawer
        open={qualityDrawer !== null}
        onClose={() => setQualityDrawer(null)}
        anchorName={qualityDrawer?.anchorName ?? ''}
        anchorId={qualityDrawer?.anchorId}
        preset={preset}
        startDate={startDate}
        endDate={endDate}
      />

      {metricDrawer && showMetrics ? (
        <BoardMetricDrawer
          open={Boolean(metricDrawer)}
          onClose={() => {
            setMetricDrawer(null)
            setReturnRefundDrawerAnchor(null)
            setReturnCountDrawerAnchor(null)
          }}
          metric={metricDrawer}
          startDate={startDate}
          endDate={endDate}
          preset={preset}
          anchorId={
            metricDrawer === 'offlineGmv'
              ? undefined
              : returnRefundDrawerAnchor?.anchorId ??
                returnCountDrawerAnchor?.anchorId ??
                selectedAnchorMeta?.anchorId
          }
          anchorName={
            metricDrawer === 'offlineGmv'
              ? undefined
              : returnRefundDrawerAnchor?.anchorName ??
                returnCountDrawerAnchor?.anchorName ??
                selectedAnchorMeta?.anchorName
          }
          cardValueRaw={
            metricDrawer === 'offlineGmv'
              ? Number(boardGmvSplit.offlineGmv ?? 0)
              : metricDrawer === 'returnRefundCount' && returnRefundDrawerAnchor
              ? Number(
                  anchors.find((a) => String(a.anchorName) === returnRefundDrawerAnchor.anchorName)
                    ?.returnRefundCount ?? 0,
                )
              : metricDrawer === 'returnCount' && returnCountDrawerAnchor
                ? Number(
                    anchors.find((a) => String(a.anchorName) === returnCountDrawerAnchor.anchorName)
                      ?.returnCount ??
                      anchors.find((a) => String(a.anchorName) === returnCountDrawerAnchor.anchorName)
                        ?.refundOrderCount ??
                      0,
                  )
                : anchorSummaryMetricValue(filteredPerformanceSummary, metricDrawer)
          }
          blacklistedBuyerIds={blacklistedBuyerIds}
          onOrderAnchorAssigned={
            metricDrawer === 'offlineGmv' ? undefined : handleOrderAnchorAssigned
          }
        />
      ) : null}
    </div>
  )
}
