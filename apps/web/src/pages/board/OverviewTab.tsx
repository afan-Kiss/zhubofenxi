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
import { BusinessSyncProgressCard } from '../../components/board/BusinessSyncProgressCard'
import { CookieHealthBanner } from '../../components/board/CookieHealthBanner'
import { OfficialQualitySyncNote } from '../../components/board/OfficialQualitySyncNote'
import {
  BoardLiveQueryAutoRefresh,
  useBoardLiveQuery,
} from '../../providers/BoardLiveQueryProvider'
import { resolveProgressCardVariant } from '../../lib/business-sync-ui'
import { showLongPeriodRates } from '../../lib/board-rate-display'
import { MetricGridTransition, StaggerCard } from '../../components/ui/MetricGridTransition'

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

  const [metricDrawer, setMetricDrawer] = useState<BoardMetricKey | null>(null)

  const ds = displaySummary
  const blacklistedBuyerIds = data?.blacklistedBuyerIds ?? []
  const showRates = showLongPeriodRates(preset, startDate, endDate)
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
              label={<MetricStatLabel label="本期销售额" metricKey="totalGmv" />}
              value={animMoney(Number(ds.totalGmv ?? 0))}
              onClick={() => setMetricDrawer('gmv')}
              hint="查看相关订单"
            />
            </StaggerCard>
            <StaggerCard index={2}>
            <BoardStatCard
              label={<MetricStatLabel label="有效成交额" metricKey="validSalesAmount" />}
              value={animMoney(Number(ds.validSalesAmount ?? 0))}
              onClick={() => setMetricDrawer('effectiveGmv')}
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
              label={<MetricStatLabel label="退款金额" metricKey="returnAmount" />}
              value={animMoney(Number(ds.returnAmount ?? 0))}
              onClick={() => setMetricDrawer('returnAmount')}
              hint="点击查看明细"
            />
            </StaggerCard>
            <StaggerCard index={5}>
            <BoardStatCard
              label={<MetricStatLabel label="支付订单数" metricKey="orderCount" />}
              value={animCount(Number(ds.orderCount ?? 0))}
              onClick={() => setMetricDrawer('orderCount')}
              hint="点击查看明细"
            />
            </StaggerCard>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StaggerCard index={6}>
            <BoardStatCard
              label={<MetricStatLabel label="签收单数" metricKey="signedOrderCount" />}
              value={animCount(Number(ds.signedOrderCount ?? 0))}
              onClick={() => setMetricDrawer('signedCount')}
              hint="查看相关订单"
            />
            </StaggerCard>
            {showRates && (
              <>
                <StaggerCard index={7}>
                <BoardStatCard
                  label={<MetricStatLabel label="签收率" metricKey="signRate" />}
                  value={animRate(Number(ds.signRate ?? 0))}
                  onClick={() => setMetricDrawer('signRate')}
                  hint="点击查看明细"
                />
                </StaggerCard>
                <StaggerCard index={8}>
                <BoardStatCard
                  label={<MetricStatLabel label="退款率" metricKey="returnRate" />}
                  value={animRate(Number(ds.returnRate ?? 0))}
                  onClick={() => setMetricDrawer('returnRate')}
                  hint="点击查看明细"
                />
                </StaggerCard>
                <StaggerCard index={9}>
                <BoardStatCard
                  label={<MetricStatLabel label="品退率" metricKey="qualityReturnRate" />}
                  value={animRate(Number(ds.qualityReturnRate ?? 0))}
                  onClick={() => setMetricDrawer('qualityReturnRate')}
                  hint="点击查看明细"
                />
                </StaggerCard>
              </>
            )}
            <StaggerCard index={showRates ? 10 : 7}>
            <BoardStatCard
              label={<MetricStatLabel label="退款单数" metricKey="returnCount" />}
              value={animCount(Number(ds.returnCount ?? 0))}
              onClick={() => setMetricDrawer('returnCount')}
              hint="点击查看明细"
            />
            </StaggerCard>
            <StaggerCard index={showRates ? 11 : 8}>
            <BoardStatCard
              label={<MetricStatLabel label="品退单数" metricKey="qualityReturnCount" />}
              value={animCount(Number(ds.qualityReturnCount ?? 0))}
              onClick={() => setMetricDrawer('qualityReturnCount')}
              hint="点击查看明细"
            />
            </StaggerCard>
          </div>
        </MetricGridTransition>
      ) : null}

      {metricDrawer && (
        <BoardMetricDrawer
          open={Boolean(metricDrawer)}
          onClose={() => setMetricDrawer(null)}
          metric={metricDrawer}
          startDate={startDate}
          endDate={endDate}
          preset={preset}
          blacklistedBuyerIds={blacklistedBuyerIds}
          cardValueRaw={Number(
            ds?.[
              metricDrawer.includes('Rate')
                ? metricDrawer
                : metricDrawer === 'gmv'
                  ? 'totalGmv'
                  : metricDrawer === 'effectiveGmv'
                    ? 'validSalesAmount'
                    : metricDrawer === 'returnAmount'
                      ? 'returnAmount'
                      : metricDrawer
            ] ?? 0,
          )}
        />
      )}
    </div>
  )
}
