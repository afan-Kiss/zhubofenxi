import React, { useCallback, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { createPortal } from 'react-dom'
import { apiRequest } from '../../lib/api'
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
  formatPercent,
  formatRatePercent,
  formatStayDurationSeconds,
} from '../../components/operations/operationsReportFormatters'
import type {
  DailyOperationsReportPayload,
  OpsReviewNotePayload,
  WithOperationsReportCacheMeta,
} from './operationsReportTypes'
import { OperationsReportCacheHint } from '../../components/operations/OperationsReportCacheHint'
import { OperationsMetricDrillCard } from '../../components/operations/OperationsMetricDrillCard'
import type { OperationsBiDrillRequest } from './operationsBiDrillTypes'
import { OperationsCoreMetrics, CollapsibleWarnings } from '../../components/operations/charts/OperationsCoreMetrics'
import { DailyReportCharts } from '../../components/operations/charts/DailyReportCharts'
import { useChartTopLimit } from '../../components/operations/charts/useChartTopLimit'

interface Props {
  dateKey: string
}

export const OperationsDailyReport: React.FC<Props> = ({ dateKey }) => {
  const sheetRef = useRef<HTMLDivElement>(null)
  const topLimit = useChartTopLimit()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<DailyOperationsReportPayload | null>(null)
  const [cacheMeta, setCacheMeta] = useState<
    WithOperationsReportCacheMeta<DailyOperationsReportPayload>['cacheMeta']
  >(undefined)
  const [cacheWarning, setCacheWarning] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showFullHot, setShowFullHot] = useState(false)
  const [showFullReturn, setShowFullReturn] = useState(false)

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ startDate: dateKey, endDate: dateKey, preset: 'custom' })
      const data = await apiRequest<WithOperationsReportCacheMeta<DailyOperationsReportPayload>>(
        `/api/board/operations-report/daily?${qs}`,
      )
      const { cacheMeta: meta, cacheWarning: warning, ...payload } = data
      setReport(payload)
      setCacheMeta(meta)
      setCacheWarning(warning ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载运营日报失败')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [dateKey])

  React.useEffect(() => {
    void loadReport()
  }, [loadReport])

  const handleExportImage = async () => {
    if (!sheetRef.current || !report) return
    setExporting(true)
    try {
      const dataUrl = await toPng(sheetRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      })
      setPreviewUrl(dataUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出长图失败')
    } finally {
      setExporting(false)
    }
  }

  const handleReviewSaved = (note: OpsReviewNotePayload) => {
    setReport((prev) => (prev ? { ...prev, reviewNote: note } : prev))
  }

  if (loading && !report) {
    return <p className="text-sm text-slate-500">加载运营日报...</p>
  }

  if (error && !report) {
    return (
      <div>
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => void loadReport()}
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
              value={formatPercent(s.returnOrderRate)}
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
            <OperationsMetricDrillCard label="新增粉丝" value={formatPeopleCount(s.totalNewFollowerCount)} />
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
        onRefresh={loadReport}
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

      {previewUrl
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 p-4"
              onClick={() => setPreviewUrl(null)}
            >
              <div
                className="max-h-[92vh] overflow-auto rounded-2xl bg-white p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <img src={previewUrl} alt="运营日报" className="max-w-full rounded-xl" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
