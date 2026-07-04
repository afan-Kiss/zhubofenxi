import React, { useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useOperationsReportFetch } from '../../hooks/useOperationsReportFetch'
import { OperationsReportLoadShell } from '../../components/operations/OperationsReportLoadShell'
import { AnchorOperationsTable } from '../../components/operations/AnchorOperationsTable'
import { ProductPerformanceTable } from '../../components/operations/ProductPerformanceTable'
import { AfterSalesReasonTable } from '../../components/operations/AfterSalesReasonTable'
import { OperationsReviewEditor } from '../../components/operations/OperationsReviewEditor'
import { BusinessInsightCards } from '../../components/operations/BusinessInsightCards'
import {
  formatIntegerMoney,
  formatOrderCount,
  formatRatePercent,
} from '../../components/operations/operationsReportFormatters'
import { FOLLOWER_DRILL_UNAVAILABLE_MESSAGE } from '../../lib/operations-follower-drill'
import type {
  OpsReviewNotePayload,
  WeeklyOperationsReportPayload,
  WithOperationsReportCacheMeta,
} from './operationsReportTypes'
import { OperationsReportCacheHint } from '../../components/operations/OperationsReportCacheHint'
import { OperationsMetricDrillCard } from '../../components/operations/OperationsMetricDrillCard'
import type { OperationsBiDrillRequest } from './operationsBiDrillTypes'
import { OperationsCoreMetrics } from '../../components/operations/charts/OperationsCoreMetrics'
import { WeeklyReportCharts } from '../../components/operations/charts/WeeklyReportCharts'
import { useChartTopLimit } from '../../components/operations/charts/useChartTopLimit'

interface Props {
  weekStart: string
  weekEnd: string
  onLoadingChange?: (loading: boolean) => void
}

type WeeklyLoadResult = {
  report: WeeklyOperationsReportPayload
  cacheMeta: WithOperationsReportCacheMeta<WeeklyOperationsReportPayload>['cacheMeta']
  cacheWarning: string | null
}

function highlightToProductRow(
  p: WeeklyOperationsReportPayload['hotProducts'][number],
  role: string,
): import('./operationsReportTypes').OperationsProductRow {
  return {
    productKey: p.productKey,
    itemId: '',
    productName: p.productName,
    skuName: p.skuName,
    shopName: p.shopName,
    productCode: p.productCode,
    ringSize: p.ringSize,
    barType: p.barType,
    soldCount: p.soldCount,
    soldOrderCount: p.soldOrderCount,
    paidOrderCount: p.soldOrderCount,
    soldAmountYuan: p.validAmountYuan ?? p.soldAmountYuan,
    buyerCount: p.buyerCount,
    returnOrderCount: p.returnOrderCount,
    returnRate: p.returnRate,
    productRole: role,
    productRoleLabel: p.rankReason || p.productRoleLabel,
  }
}

export const OperationsWeeklyReport: React.FC<Props> = ({ weekStart, weekEnd, onLoadingChange }) => {
  const topLimit = useChartTopLimit()
  const [showFullHot, setShowFullHot] = useState(false)
  const [showFullReturn, setShowFullReturn] = useState(false)

  const {
    data: loaded,
    loading,
    refreshing,
    error,
    load,
    setData,
  } = useOperationsReportFetch<WeeklyLoadResult>(
    async (signal) => {
      const qs = new URLSearchParams({ weekStart, weekEnd, preset: 'custom' })
      const data = await apiRequest<WithOperationsReportCacheMeta<WeeklyOperationsReportPayload>>(
        `/api/board/operations-report/weekly?${qs}`,
        { signal },
      )
      const { cacheMeta: meta, cacheWarning: warning, ...payload } = data
      return { report: payload, cacheMeta: meta, cacheWarning: warning ?? null }
    },
    [weekStart, weekEnd],
  )

  const report = loaded?.report ?? null
  const cacheMeta = loaded?.cacheMeta
  const cacheWarning = loaded?.cacheWarning ?? null

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  const handleReviewSaved = (note: OpsReviewNotePayload) => {
    setData((prev) =>
      prev ? { ...prev, report: { ...prev.report, reviewNote: note } } : prev,
    )
  }

  if (loading && !report) {
    return (
      <OperationsReportLoadShell loading={loading} refreshing={false}>
        <p className="py-6 text-sm text-slate-500">加载运营周报…</p>
      </OperationsReportLoadShell>
    )
  }

  if (error && !report) {
    return (
      <div>
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-full border border-slate-200 px-3 py-1 text-sm"
        >
          重试
        </button>
      </div>
    )
  }

  if (!report) return null

  const s = report.summary
  const drillBase: Omit<OperationsBiDrillRequest, 'target'> = {
    source: 'weekly_summary',
    startDate: weekStart,
    endDate: weekEnd,
    scope: 'weekly',
  }
  const drillContext = {
    source: 'weekly_summary' as const,
    startDate: weekStart,
    endDate: weekEnd,
    scope: 'weekly' as const,
  }
  const anchorRows = report.anchors.map((row) => ({
    anchorName: row.anchorName,
    sessionLabel: '周汇总',
    shopName: '',
    livePeriodText: '—',
    liveDurationText: `${Math.round(row.liveDurationMinutes)}分钟`,
    liveDurationMinutes: row.liveDurationMinutes,
    validAmountYuan: row.validAmountYuan,
    soldOrderCount: row.soldOrderCount,
    paidOrderCount: row.soldOrderCount,
    invalidOrderCount: 0,
    returnOrderCount: row.returnOrderCount,
    returnOrderRate: row.returnOrderRate,
    avgOrderAmountYuan:
      row.soldOrderCount > 0 ? Math.round(row.validAmountYuan / row.soldOrderCount) : null,
    hourlyAmountYuan: null,
    amountRatio: null,
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: row.dealUserCount,
    dealConversionRate: null,
    newFollowerRate: null,
  }))

  return (
    <OperationsReportLoadShell loading={loading} refreshing={refreshing}>
    <div className="space-y-4 overflow-x-hidden">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>
        <OperationsReportCacheHint cacheMeta={cacheMeta} cacheWarning={cacheWarning} className="mt-1" />
      </div>

      <OperationsCoreMetrics
        core={
          <>
            <OperationsMetricDrillCard
              label="本周有效成交"
              value={formatIntegerMoney(s.validAmountYuan)}
              drillRequest={{ ...drillBase, target: 'summary_valid_amount' }}
              footer={
                s.validAmountChangePercent != null ? (
                  <p className="mt-1 text-xs text-slate-500">
                    比上期 {s.validAmountChangePercent >= 0 ? '+' : ''}
                    {s.validAmountChangePercent}%
                  </p>
                ) : null
              }
            />
            <OperationsMetricDrillCard
              label="本周订单"
              value={formatOrderCount(s.soldOrderCount)}
              drillRequest={{ ...drillBase, target: 'summary_orders' }}
            />
            <OperationsMetricDrillCard
              label="退货单率"
              value={formatRatePercent(s.returnOrderRate)}
              drillRequest={{ ...drillBase, target: 'summary_return_rate' }}
            />
            <OperationsMetricDrillCard
              label="新增粉丝"
              value={`${s.totalNewFollowerCount}人`}
              drillUnavailableMessage={FOLLOWER_DRILL_UNAVAILABLE_MESSAGE}
            />
          </>
        }
        more={
          <>
            <OperationsMetricDrillCard
              label="比上期成交"
              value={
                s.validAmountChangePercent != null
                  ? `${s.validAmountChangePercent >= 0 ? '+' : ''}${s.validAmountChangePercent}%`
                  : '—'
              }
            />
            <OperationsMetricDrillCard
              label="比上期订单"
              value={
                s.soldOrderChangePercent != null
                  ? `${s.soldOrderChangePercent >= 0 ? '+' : ''}${s.soldOrderChangePercent}%`
                  : '—'
              }
            />
          </>
        }
      />

      <WeeklyReportCharts
        drillContext={drillContext}
        dailyTrend={report.dailyTrend}
        anchors={report.anchors}
        hotProducts={report.hotProducts}
        priceBands={report.priceBands}
      />

      <BusinessInsightCards
        insights={report.businessInsights}
        rangeStartDate={weekStart}
        rangeEndDate={weekEnd}
        scope="weekly"
        onRefresh={load}
      />

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">主播周表现</h3>
        <AnchorOperationsTable rows={anchorRows.slice(0, topLimit)} />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">热卖商品</h3>
          {report.hotProducts.length > topLimit ? (
            <button
              type="button"
              onClick={() => setShowFullHot((v) => !v)}
              className="text-xs text-rose-700 hover:underline"
            >
              {showFullHot ? '收起' : '查看完整榜单'}
            </button>
          ) : null}
        </div>
        <ProductPerformanceTable
          rows={(showFullHot ? report.hotProducts : report.hotProducts.slice(0, topLimit)).map((p) =>
            highlightToProductRow(p, 'hot_sale'),
          )}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">售后原因</h3>
        <AfterSalesReasonTable rows={report.afterSalesReasons.slice(0, topLimit)} />
      </section>

      {report.productRankingQuality || report.reviewNote ? (
        <section className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">风险与数据质量</h3>
          {report.productRankingQuality?.warnings?.length ? (
            <ul className="mb-2 text-xs text-amber-800 space-y-0.5">
              {report.productRankingQuality.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {report.summary.dealUserCount == null ? (
            <p className="text-xs text-amber-800">官方成交人数缺失，成交率不可计算</p>
          ) : null}
          {report.highReturnProducts.length === 0 && report.highReturnSampleTooSmall?.length ? (
            <p className="text-xs text-amber-800">高退货商品均未达正式榜样本门槛</p>
          ) : null}
          {!report.productRankingQuality?.slowReliable ? (
            <p className="text-xs text-amber-800">
              滞销：无曝光/主推依据，未生成自然滞销榜
            </p>
          ) : null}
        </section>
      ) : null}

      <OperationsReviewEditor
        reportDate={weekStart}
        reportType="weekly"
        initialNote={report.reviewNote}
        onSaved={handleReviewSaved}
      />
    </div>
    </OperationsReportLoadShell>
  )
}
