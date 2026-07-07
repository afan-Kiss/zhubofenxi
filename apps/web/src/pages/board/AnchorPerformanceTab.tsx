import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronDown, Package, Percent, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
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
import { formatDataFreshnessTime, type DataFreshnessInfo } from '../../lib/data-freshness'
import type { BoardMetricExplainKey } from '../../lib/metricExplain'

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
  valueKey: 'totalGmv' | 'actualSignedAmount' | 'orderCount' | 'returnRate'
}

const ANCHOR_SUMMARY_CARDS: AnchorSummaryCardDef[] = [
  {
    label: '支付金额',
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
    label: '退款率',
    metricExplainKey: 'returnRate',
    drawerKey: 'returnRate',
    type: 'rate',
    tone: 'orange',
    helper: '退款订单占支付订单比例',
    hint: '点击查看明细',
    icon: Percent,
    valueKey: 'returnRate',
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
    case 'returnRate':
      return Number(cards.returnRate ?? cards.refundRate ?? 0)
    default:
      return 0
  }
}

function anchorCardRawValue(cards: Record<string, unknown>, key: AnchorSummaryCardDef['valueKey']): number {
  if (key === 'totalGmv') return Number(cards.totalGmv ?? cards.gmv ?? 0)
  if (key === 'actualSignedAmount') return Number(cards.actualSignedAmount ?? 0)
  if (key === 'orderCount') return Number(cards.orderCount ?? 0)
  return Number(cards.returnRate ?? 0)
}

function formatFreshnessLine(
  freshness: DataFreshnessInfo | null | undefined,
  syncSuccessAt: string | null | undefined,
): string | null {
  const parts: string[] = []
  if (freshness?.latestOrderTime) {
    parts.push(`数据更新 ${formatDataFreshnessTime(freshness.latestOrderTime)}`)
  }
  const syncAt = syncSuccessAt ?? freshness?.lastQianfanSyncAt
  if (syncAt) {
    parts.push(`同步 ${formatDataFreshnessTime(syncAt)}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
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
  const [shipmentPhotos, setShipmentPhotos] = useState<DailyReportImageItem[]>([])
  const [shipmentPhotoDataUrls, setShipmentPhotoDataUrls] = useState<Record<string, string>>({})
  const [reportPhotosStale, setReportPhotosStale] = useState(false)
  const [realtimeSyncHint, setRealtimeSyncHint] = useState<string | null>(null)
  const autoSyncFailedRef = useRef(false)
  const REALTIME_SYNC_FAIL_HINT = '自动更新失败，当前先展示本地已有数据。可以稍后刷新。'

  useEffect(() => {
    autoSyncFailedRef.current = false
    setRealtimeSyncHint(null)
  }, [preset, startDate, endDate])

  useEffect(() => {
    if (preset !== 'today' && preset !== 'yesterday') return

    const syncing = isBusinessSyncActive(syncMeta?.businessSync?.status)
    if (syncing || activeSyncJob || triggerSyncBusy) return

    setRealtimeSyncHint(
      preset === 'today'
        ? '正在更新今日数据，完成后会自动刷新。'
        : '正在更新昨日数据，完成后会自动刷新。',
    )
    void triggerBusinessSync()
      .then(() => {
        autoSyncFailedRef.current = false
      })
      .catch(() => {
        autoSyncFailedRef.current = true
        setRealtimeSyncHint(REALTIME_SYNC_FAIL_HINT)
      })
    // 仅在切换今日/昨日范围时触发；同步状态变化不重复拉单
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncMeta/activeSyncJob 仅用于运行中守卫
  }, [preset, startDate, endDate, triggerBusinessSync])

  useEffect(() => {
    if (preset !== 'today' && preset !== 'yesterday') return
    const syncing = isBusinessSyncActive(syncMeta?.businessSync?.status)
    if (syncing || activeSyncJob || triggerSyncBusy) return
    if (autoSyncFailedRef.current) return
    setRealtimeSyncHint((prev) =>
      prev === REALTIME_SYNC_FAIL_HINT ? prev : null,
    )
  }, [preset, syncMeta?.businessSync?.status, activeSyncJob, triggerSyncBusy])

  const handleShipmentImagesChange = useCallback((images: DailyReportImageItem[]) => {
    setShipmentPhotos(images)
    setReportPhotosStale(true)
    void prefetchShipmentPhotoDataUrls(images).then(setShipmentPhotoDataUrls)
  }, [])

  const allAnchors = useMemo(
    () => sortAnchorLeaderboardByPerformance((data?.anchorLeaderboard as Array<Record<string, unknown>>) ?? []),
    [data?.anchorLeaderboard],
  )

  const handleOrderAnchorAssigned = useCallback(() => {
    void reload()
  }, [reload])

  const options = allAnchors.map((a) => ({
    id: String(a.anchorId ?? a.anchorName),
    name: String(a.anchorName),
  }))

  const anchors = useMemo(() => {
    if (anchorFilter === '全部') return allAnchors
    return allAnchors.filter(
      (a) => String(a.anchorName) === anchorFilter || String(a.anchorName).includes(anchorFilter),
    )
  }, [allAnchors, anchorFilter])

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
    Boolean(filteredPerformanceSummary) && Object.keys(filteredPerformanceSummary ?? {}).length > 0
  const cards = filteredPerformanceSummary ?? {}
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

  const freshnessLine = formatFreshnessLine(
    dataFreshness,
    syncMeta?.businessSync?.lastSuccessAt ?? null,
  )

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
    dataDisplayStatus === 'empty' &&
    !showProgressCard

  const renderAnchorCardValue = (card: AnchorSummaryCardDef): React.ReactNode => {
    const className = 'inline-block font-bold tracking-tight text-slate-900'
    if (card.type === 'rate' && anchorRowRate(cards, 'returnRate') == null) {
      return <span className={className}>--</span>
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
          <p className="mt-0.5 text-sm text-slate-500">按归属时段汇总各主播经营表现</p>
          {!dataFreshnessLoading && freshnessLine ? (
            <p className="mt-1 text-xs text-slate-400">{freshnessLine}</p>
          ) : null}
          {realtimeSyncHint ? (
            <p className="mt-1 text-xs text-rose-600">{realtimeSyncHint}</p>
          ) : null}
        </div>
        {(preset === 'today' || preset === 'yesterday') && startDate ? (
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
      />
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
              shipmentPhotos={shipmentPhotos}
              shipmentPhotoDataUrls={shipmentPhotoDataUrls}
              photosStale={reportPhotosStale}
              onGenerated={() => setReportPhotosStale(false)}
            />
          </div>
          <DailyReportShipmentPhotos
            reportDate={startDate}
            onImagesChange={handleShipmentImagesChange}
          />
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {ANCHOR_SUMMARY_CARDS.map((card, index) => {
                const Icon = card.icon
                return (
                  <StaggerCard key={card.valueKey} index={index} className="h-full">
                    <BoardSummaryMetricCard
                      label={
                        <MetricStatLabel label={card.label} metricKey={card.metricExplainKey} />
                      }
                      value={renderAnchorCardValue(card)}
                      helper={card.helper}
                      hint={card.hint}
                      tone={card.tone}
                      icon={Icon}
                      onClick={() => setMetricDrawer(card.drawerKey)}
                    />
                  </StaggerCard>
                )
              })}
            </div>
          </MetricGridTransition>
          <div className="rounded-2xl border border-rose-100/50 bg-white p-4 shadow-sm">
            <MetricGridTransition transitionKey={anchorTransitionKey} loading={isLoadingRange}>
              <AnchorLeaderboardPanel
                rows={anchors}
                compareRows={allAnchors}
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
          onClose={() => setMetricDrawer(null)}
          metric={metricDrawer}
          startDate={startDate}
          endDate={endDate}
          preset={preset}
          anchorId={selectedAnchorMeta?.anchorId}
          anchorName={selectedAnchorMeta?.anchorName}
          cardValueRaw={anchorSummaryMetricValue(filteredPerformanceSummary, metricDrawer)}
          blacklistedBuyerIds={blacklistedBuyerIds}
          onOrderAnchorAssigned={handleOrderAnchorAssigned}
        />
      ) : null}
    </div>
  )
}
