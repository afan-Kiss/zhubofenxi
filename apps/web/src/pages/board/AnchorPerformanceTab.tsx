import React, { useMemo, useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { RangeBar } from '../../components/board/RangeBar'
import { BoardStatRangeNote } from '../../components/board/BoardStatRangeNote'
import { AnimatedStatValue } from '../../components/board/AnimatedStatValue'
import { AnchorOrderDrawer } from '../../components/board/AnchorOrderDrawer'
import { AnchorLeaderboardPanel } from '../../components/board/AnchorLeaderboardPanel'
import { MetricStatLabel } from '../../components/board/MetricStatLabel'
import { BoardSyncStatusHeader } from '../../components/board/BoardSyncStatusHeader'
import { BusinessSyncProgressCard } from '../../components/board/BusinessSyncProgressCard'
import { resolveProgressCardVariant } from '../../lib/business-sync-ui'
import { CookieHealthBanner } from '../../components/board/CookieHealthBanner'
import { OfficialQualitySyncNote } from '../../components/board/OfficialQualitySyncNote'
import { anchorRowRate } from '../../lib/anchor-leaderboard-row'
import {
  BoardLiveQueryAutoRefresh,
  useBoardLiveQuery,
} from '../../providers/BoardLiveQueryProvider'
import { showLongPeriodRates } from '../../lib/board-rate-display'
import { MetricGridTransition, StaggerCard } from '../../components/ui/MetricGridTransition'
import { DailyReportExportPanel } from '../../components/board/DailyReportExportPanel'

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

  const [anchorFilter, setAnchorFilter] = useState('全部')
  const [anchorDrawer, setAnchorDrawer] = useState<{
    anchorName: string
    anchorId?: string
    rowSnapshot: Record<string, unknown>
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
  const hasPerformanceData =
    Boolean(performanceSummary) && Object.keys(performanceSummary ?? {}).length > 0
  const cards = performanceSummary ?? {}
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

  return (
    <div className="space-y-4" data-testid="anchor-performance-page">
      <BoardLiveQueryAutoRefresh />
      <CookieHealthBanner cookieHealth={cookieHealth} />
      <div>
        <h2 className="text-xl font-semibold text-slate-900">主播业绩</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          基于后台自动同步的本地订单 · 主播归属按支付时间命中时间段配置
        </p>
        <BoardSyncStatusHeader
          syncMeta={syncMeta}
          hasDisplayData={hasPerformanceData || Boolean(displaySummary)}
          totalRawOrders={totalRawOrders}
        />
        <OfficialQualitySyncNote qualityFeedback={qualityFeedback} showLastUpdated={false} />
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

      {startDate && endDate ? (
        <DailyReportExportPanel
          preset={preset}
          startDate={startDate}
          endDate={endDate}
          disabled={!boardDataVisible || isLoading}
        />
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-rose-50/70" />
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
          ) : null}
          <MetricGridTransition
            transitionKey={summaryTransitionKey}
            loading={isLoadingRange}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StaggerCard index={0} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                <div className="text-sm text-slate-500">
                  <MetricStatLabel label="支付金额" metricKey="totalGmv" />
                </div>
                <AnimatedStatValue
                  transitionKey={statTransitionKey}
                  className="text-lg font-semibold text-slate-900"
                  value={Number(cards.totalGmv ?? cards.gmv ?? 0)}
                  format={formatMoney}
                />
              </StaggerCard>
              <StaggerCard index={1} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                <div className="text-sm text-slate-500">
                  <MetricStatLabel label="签收金额" metricKey="actualSignedAmount" />
                </div>
                <AnimatedStatValue
                  transitionKey={statTransitionKey}
                  className="text-lg font-semibold text-slate-900"
                  value={Number(cards.actualSignedAmount ?? 0)}
                  format={formatMoney}
                />
              </StaggerCard>
              <StaggerCard index={2} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                <div className="text-sm text-slate-500">
                  <MetricStatLabel label="支付订单数" metricKey="orderCount" />
                </div>
                <AnimatedStatValue
                  transitionKey={statTransitionKey}
                  className="text-lg font-semibold text-slate-900"
                  value={Number(cards.orderCount ?? 0)}
                  format={(v) => formatCount(v)}
                />
              </StaggerCard>
              <StaggerCard index={3} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                <div className="text-sm text-slate-500">
                  <MetricStatLabel label="退款率" metricKey="returnRate" />
                </div>
                {anchorRowRate(cards, 'returnRate') == null ? (
                  <span className="text-lg font-semibold text-slate-900">--</span>
                ) : (
                  <AnimatedStatValue
                    transitionKey={statTransitionKey}
                    className="text-lg font-semibold text-slate-900"
                    value={Number(cards.returnRate)}
                    format={(v) => formatRate(v)}
                  />
                )}
              </StaggerCard>
            </div>
          </MetricGridTransition>
          <div className="rounded-2xl border border-rose-100/50 bg-white p-3 shadow-sm md:p-0">
            <MetricGridTransition transitionKey={anchorTransitionKey} loading={isLoadingRange}>
              <AnchorLeaderboardPanel
                rows={anchors}
                showLongPeriodRates={showRates}
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
              />
            </MetricGridTransition>
          </div>
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
    </div>
  )
}
