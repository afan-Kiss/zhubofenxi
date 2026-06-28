import React, { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { addDaysShanghai, formatDateKeyShanghai } from '../../lib/business-timezone'
import { useOperationsReportFetch } from '../../hooks/useOperationsReportFetch'
import { OperationsReportLoadShell } from '../../components/operations/OperationsReportLoadShell'
import { AnchorRankingTable } from '../../components/operations/AnchorRankingTable'
import { ProductRankingTable } from '../../components/operations/ProductRankingTable'
import { PriceBandRankingTable } from '../../components/operations/PriceBandRankingTable'
import { AfterSalesRankingTable } from '../../components/operations/AfterSalesRankingTable'
import { RankingSummaryCards } from '../../components/operations/RankingSummaryCards'
import { BusinessInsightCards } from '../../components/operations/BusinessInsightCards'
import { RankingSection } from '../../components/operations/RankingMetricTooltip'
import { RankingQualityBadge } from '../../components/operations/RankingQualityBadge'
import type { OperationsRankingsPayload, WithOperationsReportCacheMeta } from './operationsReportTypes'
import type { OperationsBiDrillContextProps } from './operationsBiDrillTypes'
import {
  anchorDrillTarget,
  buildBossSummaryDrillRequest,
  priceBandDrillTarget,
  productDrillTarget,
} from '../../components/operations/operationsBiDrillHelpers'
import { OperationsReportCacheHint } from '../../components/operations/OperationsReportCacheHint'
import { RankingsTabCharts } from '../../components/operations/charts/RankingsTabCharts'
import { CollapsibleWarnings } from '../../components/operations/charts/OperationsCoreMetrics'
import type { BusinessInsightActionStatsPayload } from './operationsReportTypes'

type RankingsTab = 'summary' | 'anchors' | 'products' | 'priceBands' | 'afterSales'

const TABLE_DEFAULT_LIMIT = 5

function RankingsLimitedTable<T>({
  rows,
  render,
  limit = TABLE_DEFAULT_LIMIT,
}: {
  rows: T[]
  limit?: number
  render: (visibleRows: T[]) => React.ReactNode
}) {
  const [expanded, setExpanded] = React.useState(false)
  const visible = expanded ? rows : rows.slice(0, limit)
  return (
    <>
      {render(visible)}
      {rows.length > limit ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-rose-700 hover:underline"
        >
          {expanded ? '收起' : `查看完整榜单（共 ${rows.length} 条）`}
        </button>
      ) : null}
    </>
  )
}

interface Props {
  startDate: string
  endDate: string
  preset: string
  onLoadingChange?: (loading: boolean) => void
}

function yesterdayKey(): string {
  return addDaysShanghai(formatDateKeyShanghai(new Date()), -1)
}

type RankingsLoadResult = {
  payload: OperationsRankingsPayload
  cacheMeta: WithOperationsReportCacheMeta<OperationsRankingsPayload>['cacheMeta']
  cacheWarning: string | null
}

export const OperationsRankingsTab: React.FC<Props> = ({
  startDate,
  endDate,
  preset,
  onLoadingChange,
}) => {
  const [section, setSection] = useState<RankingsTab>('summary')
  const [insightStatsSummary, setInsightStatsSummary] = useState<BusinessInsightActionStatsPayload['summary'] | null>(null)
  const [rangeStart, setRangeStart] = useState(startDate)
  const [rangeEnd, setRangeEnd] = useState(endDate)
  const [rangePreset, setRangePreset] = useState(preset)

  const {
    data: loaded,
    loading,
    refreshing,
    error,
    load,
  } = useOperationsReportFetch<RankingsLoadResult>(
    async (signal) => {
      const qs = new URLSearchParams({
        startDate: rangeStart,
        endDate: rangeEnd,
        preset: rangePreset,
        scope: 'custom',
      })
      const res = await apiRequest<WithOperationsReportCacheMeta<OperationsRankingsPayload>>(
        `/api/board/operations-rankings?${qs}`,
        { signal },
      )
      const { cacheMeta: meta, cacheWarning: warning, ...payload } = res
      return { payload, cacheMeta: meta, cacheWarning: warning ?? null }
    },
    [rangeStart, rangeEnd, rangePreset],
  )

  const data = loaded?.payload ?? null
  const cacheMeta = loaded?.cacheMeta
  const cacheWarning = loaded?.cacheWarning ?? null

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    const fetchStats = async () => {
      try {
        const qs = new URLSearchParams({
          startDate: rangeStart,
          endDate: rangeEnd,
          scope: 'custom',
        })
        const res = await apiRequest<BusinessInsightActionStatsPayload>(
          `/api/board/operations-business-insight-action-stats?${qs}`,
        )
        if (!cancelled) setInsightStatsSummary(res.summary)
      } catch {
        if (!cancelled) setInsightStatsSummary(null)
      }
    }
    void fetchStats()
    return () => {
      cancelled = true
    }
  }, [data, rangeStart, rangeEnd])

  const applyPreset = (p: string) => {
    const today = formatDateKeyShanghai(new Date())
    setRangePreset(p)
    if (p === 'today') {
      setRangeStart(today)
      setRangeEnd(today)
    } else if (p === 'yesterday') {
      const y = yesterdayKey()
      setRangeStart(y)
      setRangeEnd(y)
    } else if (p === 'thisWeek') {
      const day = new Date(`${today}T12:00:00+08:00`).getDay()
      const mondayOffset = day === 0 ? -6 : 1 - day
      setRangeStart(addDaysShanghai(today, mondayOffset))
      setRangeEnd(today)
    } else if (p === 'lastWeek') {
      const day = new Date(`${today}T12:00:00+08:00`).getDay()
      const mondayOffset = day === 0 ? -6 : 1 - day
      const thisMonday = addDaysShanghai(today, mondayOffset)
      const lastMonday = addDaysShanghai(thisMonday, -7)
      const lastSunday = addDaysShanghai(thisMonday, -1)
      setRangeStart(lastMonday)
      setRangeEnd(lastSunday)
    } else if (p === 'thisMonth') {
      const m = /^(\d{4})-(\d{2})/.exec(today)
      if (m) setRangeStart(`${m[1]}-${m[2]}-01`)
      setRangeEnd(today)
    } else if (p === 'lastMonth') {
      const m = /^(\d{4})-(\d{2})/.exec(today)
      if (m) {
        const thisMonthStart = `${m[1]}-${m[2]}-01`
        const lastMonthEnd = addDaysShanghai(thisMonthStart, -1)
        setRangeStart(`${lastMonthEnd.slice(0, 7)}-01`)
        setRangeEnd(lastMonthEnd)
      }
    }
  }

  const copySummary = () => {
    if (!data) return
    const lines = data.bossSummary.map(
      (b) =>
        `${b.title}：${b.primaryText}（${b.metrics.map((m) => `${m.label}${m.value}`).join('，')}）${b.reason}`,
    )
    void navigator.clipboard.writeText(lines.join('\n'))
  }

  if (loading && !data) {
    return (
      <OperationsReportLoadShell loading={loading} refreshing={false}>
        <p className="py-6 text-sm text-slate-500">加载榜单中心…</p>
      </OperationsReportLoadShell>
    )
  }

  if (error && !data) {
    return (
      <div>
        <p className="text-sm text-red-600">{error}</p>
        <button type="button" onClick={() => void load()} className="mt-2 text-sm text-rose-600">
          重试
        </button>
      </div>
    )
  }

  if (!data) return null

  const controlsDisabled = loading

  const drillContext: OperationsBiDrillContextProps = {
    source: 'rankings',
    startDate: rangeStart,
    endDate: rangeEnd,
    scope: 'custom',
    preset: rangePreset,
  }

  const isSingleDay = rangeStart === rangeEnd

  return (
    <OperationsReportLoadShell loading={loading} refreshing={refreshing}>
    <div className="space-y-4 overflow-x-hidden">
      <OperationsReportCacheHint cacheMeta={cacheMeta} cacheWarning={cacheWarning} />
      {error && data ? (
        <p className="text-sm text-amber-700">{error}（仍显示上次数据）</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom'].map((p) => (
          <button
            key={p}
            type="button"
            disabled={controlsDisabled}
            onClick={() => applyPreset(p)}
            className={`rounded-full px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
              rangePreset === p
                ? 'bg-rose-600 text-white'
                : 'border border-slate-200 bg-white text-slate-700'
            }`}
          >
            {p === 'today'
              ? '今日'
              : p === 'yesterday'
                ? '昨日'
                : p === 'thisWeek'
                  ? '本周'
                  : p === 'lastWeek'
                    ? '上周'
                    : p === 'thisMonth'
                      ? '本月'
                      : p === 'lastMonth'
                        ? '上月'
                        : '自定义'}
          </button>
        ))}
        <label className="text-xs text-slate-600">
          起
          <input
            type="date"
            disabled={controlsDisabled}
            value={rangeStart}
            onChange={(e) => {
              setRangePreset('custom')
              setRangeStart(e.target.value)
            }}
            className="ml-1 rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
          />
        </label>
        <label className="text-xs text-slate-600">
          止
          <input
            type="date"
            disabled={controlsDisabled}
            value={rangeEnd}
            onChange={(e) => {
              setRangePreset('custom')
              setRangeEnd(e.target.value)
            }}
            className="ml-1 rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={() => void load()}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs disabled:opacity-50"
        >
          刷新
        </button>
        <button
          type="button"
          onClick={copySummary}
          className="rounded-full border border-rose-200 px-3 py-1 text-xs text-rose-700"
        >
          复制摘要
        </button>
      </div>

      {data.dataQuality.warnings.length > 0 ? (
        <CollapsibleWarnings warnings={data.dataQuality.warnings} max={5} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['summary', '摘要'],
            ['anchors', '主播'],
            ['products', '商品'],
            ['priceBands', '价格带'],
            ['afterSales', '售后'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`rounded-full px-3 py-1 text-sm ${
              section === id ? 'bg-rose-600 text-white' : 'border border-slate-200 bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'summary' ? (
        <>
          <RankingsTabCharts
            tab="summary"
            data={data}
            drillContext={drillContext}
            isSingleDay={isSingleDay}
            insightStats={insightStatsSummary}
          />
          <RankingSummaryCards
            items={data.bossSummary}
            getDrillRequest={(item) => buildBossSummaryDrillRequest(item, drillContext, data)}
          />
          <BusinessInsightCards
            insights={data.businessInsights}
            rangeStartDate={rangeStart}
            rangeEndDate={rangeEnd}
            scope="custom"
            onRefresh={load}
          />
        </>
      ) : null}

      {section === 'anchors' ? (
        <div className="space-y-6">
          <RankingsTabCharts tab="anchors" data={data} drillContext={drillContext} isSingleDay={isSingleDay} />
          {(
            [
              data.anchors.byAmount,
              data.anchors.byOrders,
              data.anchors.byHourlyAmount,
              data.anchors.byDealConversion,
              data.anchors.byNewFollowers,
              data.anchors.byFollowerConversion,
              data.anchors.byReturnRate,
            ] as const
          ).map((list) => (
            <RankingSection
              key={list.rankingType}
              title={list.title}
              subtitle={list.subtitle}
              dataQuality={list.dataQuality}
              sampleTooSmall={
                list.sampleTooSmall?.length
                  ? (
                      <AnchorRankingTable
                        rows={list.sampleTooSmall}
                        drillContext={drillContext}
                        drillTarget={anchorDrillTarget(list.rankingType)}
                      />
                    )
                  : undefined
              }
            >
              <RankingsLimitedTable
                rows={list.items}
                render={(visibleRows) => (
                  <AnchorRankingTable
                    rows={visibleRows}
                    drillContext={drillContext}
                    drillTarget={anchorDrillTarget(list.rankingType)}
                  />
                )}
              />
            </RankingSection>
          ))}
        </div>
      ) : null}

      {section === 'products' ? (
        <div className="space-y-6">
          <RankingsTabCharts tab="products" data={data} drillContext={drillContext} isSingleDay={isSingleDay} />
          {(
            [
              data.products.hot,
              data.products.byOrders,
              data.products.byQuantity,
              data.products.highAverageOrderValue,
              data.products.highReturn,
              data.products.slow,
            ] as const
          ).map((list) => (
            <RankingSection
              key={list.rankingType}
              title={list.title}
              subtitle={list.subtitle}
              dataQuality={list.dataQuality}
              forceShowTable={list.rankingType === 'product_slow' && list.items.length > 0}
              sampleTooSmall={
                list.sampleTooSmall?.length
                  ? (
                      <ProductRankingTable
                        rows={list.sampleTooSmall}
                        drillContext={drillContext}
                        drillTarget={productDrillTarget(list.rankingType)}
                      />
                    )
                  : undefined
              }
            >
              <RankingsLimitedTable
                rows={list.items}
                render={(visibleRows) => (
                  <ProductRankingTable
                    rows={visibleRows}
                    drillContext={drillContext}
                    drillTarget={productDrillTarget(list.rankingType)}
                  />
                )}
              />
            </RankingSection>
          ))}
        </div>
      ) : null}

      {section === 'priceBands' ? (
        <div className="space-y-6">
          <RankingsTabCharts tab="priceBands" data={data} drillContext={drillContext} isSingleDay={isSingleDay} />
          {(
            [
              data.priceBands.byAmount,
              data.priceBands.byOrders,
              data.priceBands.byShare,
              data.priceBands.byReturnRate,
            ] as const
          ).map((list) => (
            <RankingSection
              key={list.rankingType}
              title={list.title}
              subtitle={list.subtitle}
              dataQuality={list.dataQuality}
              sampleTooSmall={
                list.sampleTooSmall?.length
                  ? (
                      <PriceBandRankingTable
                        rows={list.sampleTooSmall}
                        drillContext={drillContext}
                        drillTarget={priceBandDrillTarget(list.rankingType)}
                      />
                    )
                  : undefined
              }
            >
              <RankingsLimitedTable
                rows={list.items}
                render={(visibleRows) => (
                  <PriceBandRankingTable
                    rows={visibleRows}
                    drillContext={drillContext}
                    drillTarget={priceBandDrillTarget(list.rankingType)}
                  />
                )}
              />
            </RankingSection>
          ))}
        </div>
      ) : null}

      {section === 'afterSales' ? (
        <div className="space-y-6">
          <RankingsTabCharts tab="afterSales" data={data} drillContext={drillContext} isSingleDay={isSingleDay} />
          <RankingSection
            title={data.afterSales.byReason.title}
            subtitle={data.afterSales.byReason.subtitle}
            dataQuality={data.afterSales.byReason.dataQuality}
          >
            <RankingsLimitedTable
              rows={data.afterSales.byReason.items}
              render={(visibleRows) => (
                <AfterSalesRankingTable
                  rows={visibleRows}
                  drillContext={drillContext}
                  drillTarget="after_sales_reason"
                />
              )}
            />
          </RankingSection>
          <RankingSection
            title={data.afterSales.byRefundAmount.title}
            subtitle={data.afterSales.byRefundAmount.subtitle}
            dataQuality={data.afterSales.byRefundAmount.dataQuality}
          >
            <RankingsLimitedTable
              rows={data.afterSales.byRefundAmount.items}
              render={(visibleRows) => (
                <AfterSalesRankingTable
                  rows={visibleRows}
                  drillContext={drillContext}
                  drillTarget="after_sales_refund_amount"
                />
              )}
            />
          </RankingSection>
        </div>
      ) : null}

      <RankingQualityBadge
        reliable={data.dataQuality.reliable}
        confidence={data.dataQuality.reliable ? 'high' : 'insufficient'}
        warnings={data.dataQuality.warnings}
      />
    </div>
    </OperationsReportLoadShell>
  )
}
