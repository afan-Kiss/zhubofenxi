import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  Package,
  PackageCheck,
  Percent,
  RotateCcw,
  TrendingUp,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { BoardSummaryMetricCard, type BoardSummaryMetricTone } from '../../components/board/BoardSummaryMetricCard'
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
import type { BoardMetricExplainKey } from '../../lib/metricExplain'

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

type SummaryCardType = 'count' | 'money' | 'rate'

interface SummaryCardDef {
  label: string
  metricExplainKey: BoardMetricExplainKey
  drawerKey: BoardMetricKey
  valueKey: keyof typeof valuePickers
  type: SummaryCardType
  tone: BoardSummaryMetricTone
  hint: string
  helper: string
  icon: LucideIcon
}

const valuePickers = {
  orderCount: (ds: Record<string, unknown>) => Number(ds.orderCount ?? 0),
  totalGmv: (ds: Record<string, unknown>) => Number(ds.totalGmv ?? 0),
  actualSignedAmount: (ds: Record<string, unknown>) => Number(ds.actualSignedAmount ?? 0),
  signedOrderCount: (ds: Record<string, unknown>) => Number(ds.signedOrderCount ?? 0),
  signRate: (ds: Record<string, unknown>) => Number(ds.signRate ?? 0),
  returnAmount: (ds: Record<string, unknown>) => Number(ds.returnAmount ?? 0),
  returnRate: (ds: Record<string, unknown>) => Number(ds.returnRate ?? 0),
  qualityReturnCount: (ds: Record<string, unknown>) => Number(ds.qualityReturnCount ?? 0),
  returnCount: (ds: Record<string, unknown>) => Number(ds.returnCount ?? 0),
} as const

const SUMMARY_CARDS: SummaryCardDef[] = [
  {
    label: '本期总订单数',
    metricExplainKey: 'orderCount',
    drawerKey: 'orderCount',
    valueKey: 'orderCount',
    type: 'count',
    tone: 'blue',
    hint: '查看相关订单',
    helper: '本期已支付订单数',
    icon: Package,
  },
  {
    label: '本期销售额[GMV]',
    metricExplainKey: 'totalGmv',
    drawerKey: 'gmv',
    valueKey: 'totalGmv',
    type: 'money',
    tone: 'violet',
    hint: '查看相关订单',
    helper: '已支付订单金额，不扣退款',
    icon: TrendingUp,
  },
  {
    label: '实际签收金额',
    metricExplainKey: 'actualSignedAmount',
    drawerKey: 'actualSignedAmount',
    valueKey: 'actualSignedAmount',
    type: 'money',
    tone: 'green',
    hint: '点击查看明细',
    helper: '符合签收口径的到账金额',
    icon: Banknote,
  },
  {
    label: '实际签收订单数',
    metricExplainKey: 'signedOrderCount',
    drawerKey: 'signedCount',
    valueKey: 'signedOrderCount',
    type: 'count',
    tone: 'green',
    hint: '查看相关订单',
    helper: '实际签收订单笔数',
    icon: PackageCheck,
  },
  {
    label: '签收率',
    metricExplainKey: 'signRate',
    drawerKey: 'signRate',
    valueKey: 'signRate',
    type: 'rate',
    tone: 'teal',
    hint: '点击查看明细',
    helper: '签收订单数占本期订单比例',
    icon: Percent,
  },
  {
    label: '退款金额',
    metricExplainKey: 'returnAmount',
    drawerKey: 'returnAmount',
    valueKey: 'returnAmount',
    type: 'money',
    tone: 'rose',
    hint: '点击查看明细',
    helper: '本期退款金额合计',
    icon: RotateCcw,
  },
  {
    label: '退款率',
    metricExplainKey: 'returnRate',
    drawerKey: 'returnRate',
    valueKey: 'returnRate',
    type: 'rate',
    tone: 'orange',
    hint: '点击查看明细',
    helper: '退款订单数占本期订单比例',
    icon: Percent,
  },
  {
    label: '品退订单数',
    metricExplainKey: 'qualityReturnCount',
    drawerKey: 'qualityReturnCount',
    valueKey: 'qualityReturnCount',
    type: 'count',
    tone: 'rose',
    hint: '点击查看明细',
    helper: '品质原因退款订单数',
    icon: AlertTriangle,
  },
  {
    label: '退款订单数',
    metricExplainKey: 'returnCount',
    drawerKey: 'returnCount',
    valueKey: 'returnCount',
    type: 'count',
    tone: 'amber',
    hint: '点击查看明细',
    helper: '发生退款的订单笔数',
    icon: Undo2,
  },
]

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

  const renderStatValue = useMemo(
    () =>
      (card: SummaryCardDef, raw: number): React.ReactNode => {
        const className = 'inline-block font-bold tracking-tight text-slate-900'
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
      },
    [formatCount, formatMoney, formatRate, statTransitionKey],
  )

  return (
    <div className="mx-auto max-w-7xl space-y-4">
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
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {SUMMARY_CARDS.map((card, index) => {
              const raw = valuePickers[card.valueKey](ds)
              const Icon = card.icon
              return (
                <StaggerCard key={card.drawerKey} index={index + 1} className="h-full">
                  <BoardSummaryMetricCard
                    label={
                      <MetricStatLabel label={card.label} metricKey={card.metricExplainKey} />
                    }
                    value={renderStatValue(card, raw)}
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
