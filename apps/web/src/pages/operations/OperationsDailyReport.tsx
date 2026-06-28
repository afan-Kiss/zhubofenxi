import React, { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { createPortal } from 'react-dom'
import { apiRequest } from '../../lib/api'
import { useOperationsReportFetch } from '../../hooks/useOperationsReportFetch'
import { OperationsReportLoadShell } from '../../components/operations/OperationsReportLoadShell'
import { ProductRankingTable } from '../../components/operations/ProductRankingTable'
import { RankingQualityBadge } from '../../components/operations/RankingQualityBadge'
import { BusinessInsightCards } from '../../components/operations/BusinessInsightCards'
import { OperationsReviewEditor } from '../../components/operations/OperationsReviewEditor'
import { OperationsReportImageSheet } from '../../components/operations/OperationsReportImageSheet'
import {
  formatDuration,
  formatHourly,
  formatIntegerMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
  formatStayDurationSeconds,
} from '../../components/operations/operationsReportFormatters'
import { FOLLOWER_DRILL_UNAVAILABLE_MESSAGE } from '../../lib/operations-follower-drill'
import type {
  DailyOperationsReportPayload,
  OpsReviewNotePayload,
  WithOperationsReportCacheMeta,
} from './operationsReportTypes'
import { OperationsReportCacheHint } from '../../components/operations/OperationsReportCacheHint'
import { ViewportModal } from '../../components/ui/ViewportModal'
import { OperationsMetricDrillCard } from '../../components/operations/OperationsMetricDrillCard'
import type { OperationsBiDrillRequest } from './operationsBiDrillTypes'
import { OperationsCoreMetrics, CollapsibleWarnings } from '../../components/operations/charts/OperationsCoreMetrics'
import { DailyReportCharts } from '../../components/operations/charts/DailyReportCharts'
import { useChartTopLimit } from '../../components/operations/charts/useChartTopLimit'

interface Props {
  dateKey: string
  onLoadingChange?: (loading: boolean) => void
}

type DailyLoadResult = {
  report: DailyOperationsReportPayload
  cacheMeta: WithOperationsReportCacheMeta<DailyOperationsReportPayload>['cacheMeta']
  cacheWarning: string | null
}

export const OperationsDailyReport: React.FC<Props> = ({ dateKey, onLoadingChange }) => {
  const sheetRef = useRef<HTMLDivElement>(null)
  const topLimit = useChartTopLimit()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showFullHot, setShowFullHot] = useState(false)
  const [showFullReturn, setShowFullReturn] = useState(false)

  const {
    data: loaded,
    loading,
    refreshing,
    error,
    load,
    setData,
  } = useOperationsReportFetch<DailyLoadResult>(
    async (signal) => {
      const qs = new URLSearchParams({ startDate: dateKey, endDate: dateKey, preset: 'custom' })
      const data = await apiRequest<WithOperationsReportCacheMeta<DailyOperationsReportPayload>>(
        `/api/board/operations-report/daily?${qs}`,
        { signal },
      )
      const { cacheMeta: meta, cacheWarning: warning, ...payload } = data
      return { report: payload, cacheMeta: meta, cacheWarning: warning ?? null }
    },
    [dateKey],
  )

  const report = loaded?.report ?? null
  const cacheMeta = loaded?.cacheMeta
  const cacheWarning = loaded?.cacheWarning ?? null

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  const handleExportImage = async () => {
    if (!sheetRef.current || !report) return
    setExporting(true)
    setExportError(null)
    try {
      const dataUrl = await toPng(sheetRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      })
      setPreviewUrl(dataUrl)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '导出长图失败')
    } finally {
      setExporting(false)
    }
  }

  const handleReviewSaved = (note: OpsReviewNotePayload) => {
    setData((prev) =>
      prev ? { ...prev, report: { ...prev.report, reviewNote: note } } : prev,
    )
  }

  if (loading && !report) {
    return (
      <OperationsReportLoadShell loading={loading} refreshing={false}>
        <p className="py-6 text-sm text-slate-500">加载运营日报…</p>
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
    source: 'daily_summary',
    startDate: dateKey,
    endDate: dateKey,
    scope: 'daily',
  }
  const drillContext = {
    source: 'daily_summary' as const,
    startDate: dateKey,
    endDate: dateKey,
    scope: 'daily' as const,
  }

  const hotRows = report.rankings?.products.hot.items ?? []
  const returnRows = report.rankings?.products.highReturn.items ?? []

  return (
    <OperationsReportLoadShell loading={loading} refreshing={refreshing}>
    <div className="space-y-4 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>
          <OperationsReportCacheHint cacheMeta={cacheMeta} cacheWarning={cacheWarning} className="mt-1" />
        </div>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void handleExportImage()}
          className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          {exporting ? '导出中...' : '导出长图'}
        </button>
      </div>

      <OperationsCoreMetrics
        core={
          <>
            <OperationsMetricDrillCard
              label="有效成交金额"
              value={formatIntegerMoney(s.validAmountYuan)}
              drillRequest={{ ...drillBase, target: 'summary_valid_amount' }}
            />
            <OperationsMetricDrillCard
              label="有效成交订单"
              value={formatOrderCount(s.soldOrderCount)}
              drillRequest={{ ...drillBase, target: 'summary_orders' }}
            />
            <OperationsMetricDrillCard
              label="退货单率"
              value={formatRatePercent(s.returnOrderRate)}
              drillRequest={{ ...drillBase, target: 'summary_return_rate' }}
            />
            <OperationsMetricDrillCard
              label="成交率"
              value={formatRatePercent(s.dealConversionRate)}
              drillRequest={{ ...drillBase, target: 'summary_deal_conversion' }}
            />
          </>
        }
        more={
          <>
            <OperationsMetricDrillCard label="客单价" value={formatIntegerMoney(s.avgOrderAmountYuan)} />
            <OperationsMetricDrillCard
              label="成交人数"
              value={formatPeopleCount(s.dealUserCount)}
              drillRequest={{ ...drillBase, target: 'summary_buyer_count' }}
            />
            <OperationsMetricDrillCard label="直播时长" value={formatDuration(s.totalLiveDurationMinutes)} />
            <OperationsMetricDrillCard
              label="每小时成交"
              value={formatHourly(s.hourlyAmountYuan)}
              drillRequest={{ ...drillBase, target: 'summary_valid_amount' }}
            />
            <OperationsMetricDrillCard label="场观" value={formatPeopleCount(s.viewSessionCount)} />
            <OperationsMetricDrillCard label="进房人数" value={formatPeopleCount(s.joinUserCount)} />
            <OperationsMetricDrillCard label="平均在线" value={formatPeopleCount(s.avgOnlineUserCount)} />
            <OperationsMetricDrillCard label="平均停留" value={formatStayDurationSeconds(s.avgViewDurationSeconds)} />
            <OperationsMetricDrillCard
              label="新增粉丝"
              value={formatPeopleCount(s.totalNewFollowerCount)}
              drillUnavailableMessage={FOLLOWER_DRILL_UNAVAILABLE_MESSAGE}
            />
            <OperationsMetricDrillCard label="粉丝率" value={formatRatePercent(s.newFollowerRate)} />
          </>
        }
      />

      <DailyReportCharts
        drillContext={drillContext}
        priceBands={report.priceBands}
        anchors={report.anchors}
        afterSalesReasons={report.afterSalesReasons}
      />

      <BusinessInsightCards
        insights={report.businessInsights}
        rangeStartDate={dateKey}
        rangeEndDate={dateKey}
        scope="daily"
        onRefresh={load}
      />

      {report.reportDataQuality?.warnings?.length ? (
        <CollapsibleWarnings warnings={report.reportDataQuality.warnings} />
      ) : null}

      {report.rankings ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">热卖商品</h3>
              {hotRows.length > topLimit ? (
                <button
                  type="button"
                  onClick={() => setShowFullHot((v) => !v)}
                  className="text-xs text-rose-700 hover:underline"
                >
                  {showFullHot ? '收起' : '查看完整榜单'}
                </button>
              ) : null}
            </div>
            <ProductRankingTable
              rows={showFullHot ? hotRows : hotRows.slice(0, topLimit)}
              drillContext={drillContext}
              drillTarget="product_hot"
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">高退货商品</h3>
              {returnRows.length > topLimit ? (
                <button
                  type="button"
                  onClick={() => setShowFullReturn((v) => !v)}
                  className="text-xs text-rose-700 hover:underline"
                >
                  {showFullReturn ? '收起' : '查看完整榜单'}
                </button>
              ) : null}
            </div>
            <ProductRankingTable
              rows={showFullReturn ? returnRows : returnRows.slice(0, topLimit)}
              drillContext={drillContext}
              drillTarget="product_high_return"
            />
          </div>
        </section>
      ) : null}

      <RankingQualityBadge
        reliable={report.reportDataQuality?.reliable ?? true}
        confidence={report.reportDataQuality?.reliable ? 'high' : 'insufficient'}
        warnings={report.reportDataQuality?.warnings}
      />

      <OperationsReviewEditor
        reportDate={dateKey}
        reportType="daily"
        initialNote={report.reviewNote}
        onSaved={handleReviewSaved}
      />

      {report
        ? createPortal(
            <div className="pointer-events-none fixed left-[-9999px] top-0">
              <OperationsReportImageSheet ref={sheetRef} data={report} />
            </div>,
            document.body,
          )
        : null}

      {previewUrl ? (
        <ViewportModal
          open={Boolean(previewUrl)}
          onClose={() => setPreviewUrl(null)}
          zIndexClass="z-[10000]"
          panelClassName="max-h-[min(92dvh,calc(100dvh-2rem))] w-[min(760px,calc(100vw-1.5rem))] overflow-auto p-4"
          backdropClassName="bg-black/55"
        >
          <img src={previewUrl} alt="运营日报" className="max-w-full rounded-xl" />
        </ViewportModal>
      ) : null}
    </div>
    </OperationsReportLoadShell>
  )
}
