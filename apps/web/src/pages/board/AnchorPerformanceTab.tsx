import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CalendarDays, Package, Percent, TrendingUp, type LucideIcon } from 'lucide-react'
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
import { BoardSyncStatusHeader } from '../../components/board/BoardSyncStatusHeader'
import { DataLastUpdateBanner } from '../../components/board/DataLastUpdateBanner'
import { BusinessSyncProgressCard } from '../../components/board/BusinessSyncProgressCard'
import { resolveProgressCardVariant } from '../../lib/business-sync-ui'
import { CookieHealthBanner } from '../../components/board/CookieHealthBanner'
import { OfficialQualitySyncNote } from '../../components/board/OfficialQualitySyncNote'
import { anchorRowRate, isSingleDayPreset, aggregateSummaryFromAnchorRows } from '../../lib/anchor-leaderboard-row'
import {
  BoardLiveQueryAutoRefresh,
  useBoardLiveQuery,
} from '../../providers/BoardLiveQueryProvider'
import { showLongPeriodRates } from '../../lib/board-rate-display'
import { MetricGridTransition, StaggerCard } from '../../components/ui/MetricGridTransition'
import { DailyReportPreviewButton } from '../../components/board/DailyReportPreviewButton'
import { AnchorEffectiveSchedulePanel } from '../../components/board/AnchorEffectiveSchedulePanel'
import { useDataFreshness } from '../../hooks/useDataFreshness'
import type { BoardMetricExplainKey } from '../../lib/metricExplain'

type AnchorSummaryCardType = 'money' | 'count' | 'rate'

interface AnchorSummaryCardDef {
  label: string
  metricExplainKey: BoardMetricExplainKey
  type: AnchorSummaryCardType
  tone: BoardSummaryMetricTone
  helper: string
  icon: LucideIcon
  valueKey: 'totalGmv' | 'actualSignedAmount' | 'orderCount' | 'returnRate'
}

const ANCHOR_SUMMARY_CARDS: AnchorSummaryCardDef[] = [
  {
    label: '支付金额',
    metricExplainKey: 'totalGmv',
    type: 'money',
    tone: 'violet',
    helper: '主播归属订单支付金额',
    icon: TrendingUp,
    valueKey: 'totalGmv',
  },
  {
    label: '签收金额',
    metricExplainKey: 'actualSignedAmount',
    type: 'money',
    tone: 'green',
    helper: '实际签收到账金额',
    icon: Banknote,
    valueKey: 'actualSignedAmount',
  },
  {
    label: '支付单数',
    metricExplainKey: 'orderCount',
    type: 'count',
    tone: 'blue',
    helper: '已支付订单笔数',
    icon: Package,
    valueKey: 'orderCount',
  },
  {
    label: '退款率',
    metricExplainKey: 'returnRate',
    type: 'rate',
    tone: 'orange',
    helper: '退款订单占支付订单比例',
    icon: Percent,
    valueKey: 'returnRate',
  },
]

function anchorCardRawValue(cards: Record<string, unknown>, key: AnchorSummaryCardDef['valueKey']): number {
  if (key === 'totalGmv') return Number(cards.totalGmv ?? cards.gmv ?? 0)
  if (key === 'actualSignedAmount') return Number(cards.actualSignedAmount ?? 0)
  if (key === 'orderCount') return Number(cards.orderCount ?? 0)
  return Number(cards.returnRate ?? 0)
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
    qualityFeedback,
    reload,
    boardSyncUiMode,
    activeSyncJob,
    totalRawOrders,
    triggerBusinessSync,
    triggerSyncBusy,
  } = useBoardLiveQuery()

  const { data: dataFreshness, loading: dataFreshnessLoading } = useDataFreshness(startDate, endDate)

  const [anchorFilter, setAnchorFilter] = useState('全部')
  const [anchorDrawer, setAnchorDrawer] = useState<{
    anchorName: string
    anchorId?: string
    rowSnapshot: Record<string, unknown>
  } | null>(null)
  const [qualityDrawer, setQualityDrawer] = useState<{
    anchorName: string
    anchorId?: string
  } | null>(null)

  const allAnchors = (data?.anchorLeaderboard as Array<Record<string, unknown>>) ?? []

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
  const hasPerformanceData =
    Boolean(filteredPerformanceSummary) && Object.keys(filteredPerformanceSummary ?? {}).length > 0
  const cards = filteredPerformanceSummary ?? {}
  const showLivePeriod = isSingleDayPreset(preset, startDate, endDate)
  const showRates = showLongPeriodRates(preset, startDate, endDate)
  const boardDataVisible =
    boardSyncUiMode === 'synced_idle' ||
    boardSyncUiMode === 'syncing_with_data' ||
    boardSyncUiMode === 'loading_range'
  const isLoadingRange = isDisplayStale && isLoading
  const showInitialSkeleton = isLoading && !hasPerformanceData && !data
  const showMetrics = hasPerformanceData && boardDataVisible

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
          <p className="mt-0.5 text-sm text-slate-500">
            基于后台自动同步的本地订单 · 6.13 起按真实直播时段归属主播（支付时间须落在开播~下播内）
          </p>
          <BoardSyncStatusHeader
            syncMeta={syncMeta}
            hasDisplayData={hasPerformanceData || Boolean(displaySummary)}
            totalRawOrders={totalRawOrders}
          />
          <DataLastUpdateBanner
            freshness={dataFreshness}
            loading={dataFreshnessLoading}
          />
          <OfficialQualitySyncNote qualityFeedback={qualityFeedback} showLastUpdated={false} />
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

      <div className="flex flex-wrap items-center gap-3">
        <DailyReportPreviewButton
          preset={preset}
          startDate={startDate}
          endDate={endDate}
          disabled={!boardDataVisible || isLoading}
        />
      </div>

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
                      tone={card.tone}
                      icon={Icon}
                    />
                  </StaggerCard>
                )
              })}
            </div>
          </MetricGridTransition>
          <div className="rounded-2xl border border-rose-100/50 bg-white p-3 shadow-sm md:p-0">
            <MetricGridTransition transitionKey={anchorTransitionKey} loading={isLoadingRange}>
              <AnchorLeaderboardPanel
                rows={anchors}
                compareRows={allAnchors}
                showLongPeriodRates={showRates}
                showLivePeriod={showLivePeriod}
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
        <>
          <AnchorEffectiveSchedulePanel startDate={startDate} endDate={endDate} />
          <AnchorPocketSummaryPanel preset={preset} startDate={startDate} endDate={endDate} />
              <AnchorAuditExportPanel startDate={startDate} endDate={endDate} />
            </>
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
    </div>
  )
}
