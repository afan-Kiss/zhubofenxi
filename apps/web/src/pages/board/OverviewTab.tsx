import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Package,
  PackageCheck,
  Percent,
  RotateCcw,
  TrendingUp,
  Undo2,
  Wallet,
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
import { BusinessSyncProgressCard } from '../../components/board/BusinessSyncProgressCard'
import { DataHealthPanel } from '../../components/board/DataHealthPanel'
import type { QualityFeedbackStatus } from '../../components/board/OfficialQualitySyncNote'
import {
  BoardLiveQueryAutoRefresh,
  useBoardLiveQuery,
} from '../../providers/BoardLiveQueryProvider'
import { resolveProgressCardVariant } from '../../lib/business-sync-ui'
import { MetricGridTransition, StaggerCard } from '../../components/ui/MetricGridTransition'
import type { BoardMetricExplainKey } from '../../lib/metricExplain'
import { apiRequest } from '../../lib/api'

function summaryMetricValue(ds: Record<string, unknown>, metric: BoardMetricKey): number {
  switch (metric) {
    case 'gmv':
      return Number(ds.totalGmv ?? 0)
    case 'effectiveGmv':
      return Number(ds.validSalesAmount ?? ds.effectiveGmv ?? 0)
    case 'orderCount':
      return Number(ds.orderCount ?? 0)
    case 'returnRate':
      return Number(ds.returnRate ?? 0)
    case 'qualityReturnCount':
      return Number(ds.qualityReturnCount ?? 0)
    case 'actualSignedAmount':
      return Number(ds.actualSignedAmount ?? 0)
    case 'signedCount':
      return Number(ds.signedOrderCount ?? ds.actualSignedCount ?? 0)
    case 'signRate':
      return Number(ds.signRate ?? 0)
    case 'returnAmount':
      return Number(ds.returnAmount ?? 0)
    case 'returnCount':
      return Number(ds.returnCount ?? 0)
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
  totalGmv: (ds: Record<string, unknown>) => Number(ds.totalGmv ?? 0),
  validSalesAmount: (ds: Record<string, unknown>) =>
    Number(ds.validSalesAmount ?? ds.effectiveGmv ?? 0),
  orderCount: (ds: Record<string, unknown>) => Number(ds.orderCount ?? 0),
  returnRate: (ds: Record<string, unknown>) => Number(ds.returnRate ?? 0),
  qualityReturnCount: (ds: Record<string, unknown>) => Number(ds.qualityReturnCount ?? 0),
  actualSignedAmount: (ds: Record<string, unknown>) => Number(ds.actualSignedAmount ?? 0),
  signedOrderCount: (ds: Record<string, unknown>) =>
    Number(ds.signedOrderCount ?? ds.actualSignedCount ?? 0),
  signRate: (ds: Record<string, unknown>) => Number(ds.signRate ?? 0),
  returnAmount: (ds: Record<string, unknown>) => Number(ds.returnAmount ?? 0),
  returnCount: (ds: Record<string, unknown>) => Number(ds.returnCount ?? 0),
} as const

/** 经营总览首屏核心 5 卡 */
const SUMMARY_CARDS: SummaryCardDef[] = [
  {
    label: '支付金额',
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
    label: '已签收金额',
    metricExplainKey: 'actualSignedAmount',
    drawerKey: 'actualSignedAmount',
    valueKey: 'actualSignedAmount',
    type: 'money',
    tone: 'green',
    hint: '点击查看明细',
    helper: '已签收/已完成且符合签收规则的订单金额',
    icon: Wallet,
  },
  {
    label: '支付单数',
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
    label: '退款率',
    metricExplainKey: 'returnRate',
    drawerKey: 'returnRate',
    valueKey: 'returnRate',
    type: 'rate',
    tone: 'orange',
    hint: '点击查看明细',
    helper: '退款订单占支付订单比例',
    icon: Percent,
  },
  {
    label: '品退单数',
    metricExplainKey: 'qualityReturnCount',
    drawerKey: 'qualityReturnCount',
    valueKey: 'qualityReturnCount',
    type: 'count',
    tone: 'rose',
    hint: '点击查看明细',
    helper: '官方品退 + 商品质量售后',
    icon: AlertTriangle,
  },
]

const MORE_SUMMARY_CARDS: SummaryCardDef[] = [
  {
    label: '签收单数',
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
    helper: '签收订单占支付订单比例',
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
    label: '退款单数',
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


function qualityReturnCardNote(
  qualityFeedback: QualityFeedbackStatus | null | undefined,
): string | null {
  if (qualityFeedback?.autoSyncStatus === 'running') {
    return '官方品退正在同步，稍后会刷新。'
  }
  if (qualityFeedback?.unmatchedCount && qualityFeedback.unmatchedCount > 0) {
    return `有 ${qualityFeedback.unmatchedCount} 条官方品退暂未匹配订单，当前品退可能偏低。`
  }
  if ((qualityFeedback?.caseCount ?? 0) === 0 && !qualityFeedback?.lastSyncedAt) {
    return '官方品退还没同步到订单，当前可能偏低'
  }
  if (qualityFeedback?.statusMessage?.trim()) {
    return qualityFeedback.statusMessage.trim()
  }
  return null
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
    totalRawLiveSessions,
    totalAfterSaleRecords,
    totalQualityCases,
    rollingDataHealthClose,
    pageFetchedAt,
    cookieHealth,
    staleMessage,
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
  const [moreMetricsOpen, setMoreMetricsOpen] = useState(true)
  const [stableUpdateBusy, setStableUpdateBusy] = useState(false)

  const overviewMeta = data?.overviewMeta
  const ds = displaySummary
  const blacklistedBuyerIds = data?.blacklistedBuyerIds ?? []
  const boardDataVisible =
    boardSyncUiMode === 'synced_idle' ||
    boardSyncUiMode === 'syncing_with_data' ||
    boardSyncUiMode === 'loading_range'
  const isLoadingRange = isDisplayStale && isLoading
  const hasMetrics = Boolean(ds)
  const showMetrics = hasMetrics && boardDataVisible
  const qualityNote = qualityReturnCardNote(qualityFeedback)
  const stableWarning = overviewMeta?.stableVsLatest?.needsManualUpdate
    ? overviewMeta.stableVsLatest.message
    : null

  const overviewTransitionKey = [
    'overview',
    data?.startDate,
    data?.endDate,
    syncMeta?.businessSync?.lastSuccessAt ?? data?.fetchedAt,
    String(ds?.totalGmv ?? ''),
    String(ds?.orderCount ?? ''),
    String(ds?.qualityReturnCount ?? ''),
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">经营总览</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            本期经营大盘 · 支付、已签收、退款、品退
          </p>
          {status === 'loading' && !displaySummary ? (
            <p className="mt-1 text-xs text-slate-400">正在读取本地数据…</p>
          ) : null}
          {overviewMeta?.stableSnapshot?.label ? (
            <p className="mt-0.5 text-xs text-emerald-700">{overviewMeta.stableSnapshot.label}</p>
          ) : null}
        </div>
      </div>

      <DataHealthPanel
        boardSyncUiMode={boardSyncUiMode}
        staleMessage={staleMessage}
        activeSyncJob={activeSyncJob}
        lastSuccessAt={syncMeta?.businessSync.lastSuccessAt ?? null}
        pageFetchedAt={pageFetchedAt}
        totalRawOrders={totalRawOrders}
        totalRawLiveSessions={totalRawLiveSessions}
        totalAfterSaleRecords={totalAfterSaleRecords}
        totalQualityCases={totalQualityCases}
        rollingDataHealthClose={rollingDataHealthClose}
        cookieHealth={cookieHealth}
      />

      {stableWarning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{stableWarning}</p>
          <button
            type="button"
            disabled={stableUpdateBusy}
            className="mt-2 rounded-full bg-amber-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
            onClick={() => {
              setStableUpdateBusy(true)
              void apiRequest<{ validSalesAmount?: number }>(
                '/api/settings/data-maintenance/update-last-month-stable-snapshot',
                { method: 'POST' },
              )
                .then(() => void reload())
                .finally(() => setStableUpdateBusy(false))
            }}
          >
            {stableUpdateBusy ? '正在更新稳定版…' : '更新上月稳定版'}
          </button>
        </div>
      ) : null}
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

      {boardSyncUiMode === 'loading_range' && !ds ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
          <p className="text-sm text-slate-600">正在切换统计范围…</p>
        </div>
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
              const cardNote =
                card.drawerKey === 'qualityReturnCount' ? qualityNote : null
              return (
                <StaggerCard key={card.drawerKey} index={index + 1} className="h-full">
                  <div className="flex h-full flex-col">
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
                    {cardNote ? (
                      <p className="mt-1 px-1 text-[11px] leading-snug text-amber-700">{cardNote}</p>
                    ) : null}
                  </div>
                </StaggerCard>
              )
            })}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setMoreMetricsOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              aria-expanded={moreMetricsOpen}
            >
              <span>更多指标</span>
              <ChevronDown
                className={`h-4 w-4 text-slate-400 transition ${moreMetricsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {moreMetricsOpen ? (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                {MORE_SUMMARY_CARDS.map((card, index) => {
                  const raw = valuePickers[card.valueKey](ds)
                  const Icon = card.icon
                  return (
                    <StaggerCard key={card.drawerKey} index={index + 6} className="h-full">
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
            ) : null}
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
          overviewStableSnapshot={
            preset === 'lastMonth' && Boolean(overviewMeta?.stableVsLatest?.needsManualUpdate)
          }
        />
      ) : null}
    </div>
  )
}
