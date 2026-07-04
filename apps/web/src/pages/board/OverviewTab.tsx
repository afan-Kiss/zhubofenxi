import React, { useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { BoardStatCard } from '../../components/board/BoardStatCard'
import { MetricStatLabel } from '../../components/board/MetricStatLabel'
import { AnimatedStatValue } from '../../components/board/AnimatedStatValue'
import { RangeBar } from '../../components/board/RangeBar'
import { BoardStatRangeNote } from '../../components/board/BoardStatRangeNote'
import {
  BoardMetricDrawer,
  type BoardMetricKey,
} from '../../components/board/BoardMetricDrawer'
import { BoardSyncStatusHeader } from '../../components/board/BoardSyncStatusHeader'
import { DataLastUpdateBanner } from '../../components/board/DataLastUpdateBanner'
import { BusinessSyncProgressCard } from '../../components/board/BusinessSyncProgressCard'
import { CookieHealthBanner } from '../../components/board/CookieHealthBanner'
import { OfficialQualitySyncNote } from '../../components/board/OfficialQualitySyncNote'
import {
  BoardLiveQueryAutoRefresh,
  useBoardLiveQuery,
} from '../../providers/BoardLiveQueryProvider'
import { resolveProgressCardVariant } from '../../lib/business-sync-ui'
import { MetricGridTransition, StaggerCard } from '../../components/ui/MetricGridTransition'
import { useDataFreshness } from '../../hooks/useDataFreshness'

function summaryMetricValue(ds: Record<string, unknown>, metric: BoardMetricKey): number {
  switch (metric) {
    case 'gmv':
      return Number(ds.totalGmv ?? 0)
    case 'actualSignedAmount':
      return Number(ds.actualSignedAmount ?? 0)
    case 'returnAmount':
      return Number(ds.returnAmount ?? 0)
    case 'orderCount':
      return Number(ds.orderCount ?? 0)
    case 'signedCount':
      return Number(ds.signedOrderCount ?? 0)
    case 'returnCount':
      return Number(ds.returnCount ?? 0)
    case 'qualityReturnCount':
      return Number(ds.qualityReturnCount ?? 0)
    case 'signRate':
      return Number(ds.signRate ?? 0)
    case 'returnRate':
      return Number(ds.returnRate ?? 0)
    default:
      return 0
  }
}

export const OverviewTab: React.FC = () => {
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
    status,
    error,
    displaySummary,
    data,
    isLoading,
    isDisplayStale,
    boardSyncUiMode,
    syncMeta,
    activeSyncJob,
    totalRawOrders,
    cookieHealth,
    dataDisplayStatus,
    startDate,
    endDate,
    resolvedRange,
    qualityFeedback,
    reload,
    triggerBusinessSync,
    triggerSyncBusy,
  } = useBoardLiveQuery()

  const { data: dataFreshness, loading: dataFreshnessLoading } = useDataFreshness(startDate, endDate)

  const [metricDrawer, setMetricDrawer] = useState<BoardMetricKey | null>(null)

  const ds = displaySummary
  const blacklistedBuyerIds = data?.blacklistedBuyerIds ?? []
  const boardDataVisible =
    boardSyncUiMode === 'synced_idle' ||
    boardSyncUiMode === 'syncing_with_data' ||
    boardSyncUiMode === 'loading_range'
  const isLoadingRange = isDisplayStale && isLoading
  const hasMetrics = Boolean(ds)
  const showMetrics = hasMetrics && boardDataVisible

  const overviewTransitionKey = [
    'overview',
    data?.startDate,
    data?.endDate,
    syncMeta?.businessSync?.lastSuccessAt ?? data?.fetchedAt,
    String(ds?.totalGmv ?? ''),
    String(ds?.orderCount ?? ''),
  ]
    .filter((v) => v != null && v !== '')
    .join('|')
  const statTransitionKey = overviewTransitionKey

  const progressVariant = resolveProgressCardVariant({
    hasDisplayData: Boolean(ds),
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
    !ds &&
    boardSyncUiMode === 'synced_idle' &&
    dataDisplayStatus === 'empty' &&
    !showProgressCard

  const animMoney = (n: number) => (
    <AnimatedStatValue
      transitionKey={statTransitionKey}
      value={n}
      format={(v) => formatMoney(v)}
      className="text-2xl font-semibold tracking-tight text-slate-900"
    />
  )
  const animCount = (n: number) => (
    <AnimatedStatValue
      transitionKey={statTransitionKey}
      value={n}
      format={(v) => formatCount(v)}
      className="text-2xl font-semibold tracking-tight text-slate-900"
    />
  )
  const animRate = (n: number) => (
    <AnimatedStatValue
      transitionKey={statTransitionKey}
      value={n}
      format={(v) => formatRate(v)}
      className="text-2xl font-semibold tracking-tight text-slate-900"
    />
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <BoardLiveQueryAutoRefresh />
      <CookieHealthBanner cookieHealth={cookieHealth} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">经营总览</h2>
          <p className="mt-0.5 text-sm text-slate-500">本期经营大盘 · 销售、签收与售后风险</p>
          <BoardSyncStatusHeader
            syncMeta={syncMeta}
            hasDisplayData={Boolean(ds)}
            totalRawOrders={totalRawOrders}
          />
          <DataLastUpdateBanner
            freshness={dataFreshness}
            loading={dataFreshnessLoading}
          />
          <OfficialQualitySyncNote qualityFeedback={qualityFeedback} showLastUpdated={false} />
        </div>
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

      {status === 'failed' && !ds && boardSyncUiMode !== 'empty_failed' ? (
        <div className="rounded-2xl border border-dashed border-red-200 bg-red-50/40 p-8 text-center">
          <p className="text-sm text-red-800">{error ?? '加载失败'}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-4 text-sm text-rose-600 underline"
          >
            重新加载
          </button>
        </div>
      ) : null}

      {showRangeEmptyOnly ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
          <p className="text-sm text-slate-600">当前日期范围内暂无订单数据。</p>
        </div>
      ) : null}

      {showMetrics && ds ? (
        <MetricGridTransition
          transitionKey={overviewTransitionKey}
          loading={isLoadingRange}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StaggerCard index={1}>
              <BoardStatCard
                label={<MetricStatLabel label="本期总订单数" metricKey="orderCount" />}
                value={animCount(Number(ds.orderCount ?? 0))}
                onClick={() => setMetricDrawer('orderCount')}
                hint="查看相关订单"
              />
            </StaggerCard>
            <StaggerCard index={2}>
              <BoardStatCard
                label={<MetricStatLabel label="本期销售额[GMV]" metricKey="totalGmv" />}
                value={animMoney(Number(ds.totalGmv ?? 0))}
                onClick={() => setMetricDrawer('gmv')}
                hint="查看相关订单"
              />
            </StaggerCard>
            <StaggerCard index={3}>
              <BoardStatCard
                label={<MetricStatLabel label="实际签收金额" metricKey="actualSignedAmount" />}
                value={animMoney(Number(ds.actualSignedAmount ?? 0))}
                onClick={() => setMetricDrawer('actualSignedAmount')}
                hint="点击查看明细"
              />
            </StaggerCard>
            <StaggerCard index={4}>
              <BoardStatCard
                label={<MetricStatLabel label="实际签收订单数" metricKey="signedOrderCount" />}
                value={animCount(Number(ds.signedOrderCount ?? 0))}
                onClick={() => setMetricDrawer('signedCount')}
                hint="查看相关订单"
              />
            </StaggerCard>
            <StaggerCard index={5}>
              <BoardStatCard
                label={<MetricStatLabel label="签收率" metricKey="signRate" />}
                value={animRate(Number(ds.signRate ?? 0))}
                onClick={() => setMetricDrawer('signRate')}
                hint="点击查看明细"
              />
            </StaggerCard>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StaggerCard index={6}>
              <BoardStatCard
                label={<MetricStatLabel label="退款金额" metricKey="returnAmount" />}
                value={animMoney(Number(ds.returnAmount ?? 0))}
                onClick={() => setMetricDrawer('returnAmount')}
                hint="点击查看明细"
              />
            </StaggerCard>
            <StaggerCard index={7}>
              <BoardStatCard
                label={<MetricStatLabel label="退款率" metricKey="returnRate" />}
                value={animRate(Number(ds.returnRate ?? 0))}
                onClick={() => setMetricDrawer('returnRate')}
                hint="点击查看明细"
              />
            </StaggerCard>
            <StaggerCard index={8}>
              <BoardStatCard
                label={<MetricStatLabel label="品退订单数" metricKey="qualityReturnCount" />}
                value={animCount(Number(ds.qualityReturnCount ?? 0))}
                onClick={() => setMetricDrawer('qualityReturnCount')}
                hint="点击查看明细"
              />
            </StaggerCard>
            <StaggerCard index={9}>
              <BoardStatCard
                label={<MetricStatLabel label="退款订单数" metricKey="returnCount" />}
                value={animCount(Number(ds.returnCount ?? 0))}
                onClick={() => setMetricDrawer('returnCount')}
                hint="点击查看明细"
              />
            </StaggerCard>
          </div>
        </MetricGridTransition>
      ) : null}

      {metricDrawer && ds ? (
        <BoardMetricDrawer
          open={Boolean(metricDrawer)}
          onClose={() => setMetricDrawer(null)}
          metric={metricDrawer}
          startDate={startDate}
          endDate={endDate}
          preset={preset}
          blacklistedBuyerIds={blacklistedBuyerIds}
          cardValueRaw={summaryMetricValue(ds, metricDrawer)}
        />
      ) : null}
    </div>
  )
}
