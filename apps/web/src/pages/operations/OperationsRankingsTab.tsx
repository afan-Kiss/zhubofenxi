import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { addDaysShanghai, formatDateKeyShanghai } from '../../lib/business-timezone'
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

type RankingsTab = 'summary' | 'anchors' | 'products' | 'priceBands' | 'afterSales'

interface Props {
  startDate: string
  endDate: string
  preset: string
}

function yesterdayKey(): string {
  return addDaysShanghai(formatDateKeyShanghai(new Date()), -1)
}

export const OperationsRankingsTab: React.FC<Props> = ({ startDate, endDate, preset }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<OperationsRankingsPayload | null>(null)
  const [cacheMeta, setCacheMeta] = useState<
    WithOperationsReportCacheMeta<OperationsRankingsPayload>['cacheMeta']
  >(undefined)
  const [cacheWarning, setCacheWarning] = useState<string | null>(null)
  const [section, setSection] = useState<RankingsTab>('summary')
  const [rangeStart, setRangeStart] = useState(startDate)
  const [rangeEnd, setRangeEnd] = useState(endDate)
  const [rangePreset, setRangePreset] = useState(preset)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        startDate: rangeStart,
        endDate: rangeEnd,
        preset: rangePreset,
        scope: 'custom',
      })
      const res = await apiRequest<WithOperationsReportCacheMeta<OperationsRankingsPayload>>(
        `/api/board/operations-rankings?${qs}`,
      )
      const { cacheMeta: meta, cacheWarning: warning, ...payload } = res
      setData(payload)
      setCacheMeta(meta)
      setCacheWarning(warning ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载榜单失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [rangeStart, rangeEnd, rangePreset])

  useEffect(() => {
    void load()
  }, [load])

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
    return <p className="text-sm text-slate-500">加载榜单中心...</p>
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

  const drillContext: OperationsBiDrillContextProps = {
    source: 'rankings',
    startDate: rangeStart,
    endDate: rangeEnd,
    scope: 'custom',
    preset: rangePreset,
  }

  return (
    <div className="space-y-4">
      <OperationsReportCacheHint cacheMeta={cacheMeta} cacheWarning={cacheWarning} />
      <div className="flex flex-wrap items-center gap-2">
        {['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'custom'].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            className={`rounded-full px-3 py-1 text-xs ${
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
                      : '自定义'}
          </button>
        ))}
        <label className="text-xs text-slate-600">
          起
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => {
              setRangePreset('custom')
              setRangeStart(e.target.value)
            }}
            className="ml-1 rounded border border-slate-200 px-2 py-1"
          />
        </label>
        <label className="text-xs text-slate-600">
          止
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => {
              setRangePreset('custom')
              setRangeEnd(e.target.value)
            }}
            className="ml-1 rounded border border-slate-200 px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs"
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
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {data.dataQuality.warnings.slice(0, 6).map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
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
              <AnchorRankingTable
                rows={list.items}
                drillContext={drillContext}
                drillTarget={anchorDrillTarget(list.rankingType)}
              />
            </RankingSection>
          ))}
        </div>
      ) : null}

      {section === 'products' ? (
        <div className="space-y-6">
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
              <ProductRankingTable
                rows={list.items}
                drillContext={drillContext}
                drillTarget={productDrillTarget(list.rankingType)}
              />
            </RankingSection>
          ))}
        </div>
      ) : null}

      {section === 'priceBands' ? (
        <div className="space-y-6">
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
              <PriceBandRankingTable
                rows={list.items}
                drillContext={drillContext}
                drillTarget={priceBandDrillTarget(list.rankingType)}
              />
            </RankingSection>
          ))}
        </div>
      ) : null}

      {section === 'afterSales' ? (
        <div className="space-y-6">
          <RankingSection
            title={data.afterSales.byReason.title}
            subtitle={data.afterSales.byReason.subtitle}
            dataQuality={data.afterSales.byReason.dataQuality}
          >
            <AfterSalesRankingTable
              rows={data.afterSales.byReason.items}
              drillContext={drillContext}
              drillTarget="after_sales_reason"
            />
          </RankingSection>
          <RankingSection
            title={data.afterSales.byRefundAmount.title}
            subtitle={data.afterSales.byRefundAmount.subtitle}
            dataQuality={data.afterSales.byRefundAmount.dataQuality}
          >
            <AfterSalesRankingTable
              rows={data.afterSales.byRefundAmount.items}
              drillContext={drillContext}
              drillTarget="after_sales_refund_amount"
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
  )
}
