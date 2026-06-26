import React, { useCallback, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { createPortal } from 'react-dom'
import { apiRequest } from '../../lib/api'
import { AnchorOperationsTable } from '../../components/operations/AnchorOperationsTable'
import { ProductRankingTable } from '../../components/operations/ProductRankingTable'
import { ProductPerformanceTable } from '../../components/operations/ProductPerformanceTable'
import { RankingQualityBadge } from '../../components/operations/RankingQualityBadge'
import { BusinessInsightCards } from '../../components/operations/BusinessInsightCards'
import { PriceBandTable } from '../../components/operations/PriceBandTable'
import { AfterSalesReasonTable } from '../../components/operations/AfterSalesReasonTable'
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
} from './operationsReportTypes'

interface Props {
  dateKey: string
}

export const OperationsDailyReport: React.FC<Props> = ({ dateKey }) => {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<DailyOperationsReportPayload | null>(null)
  const [exporting, setExporting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ startDate: dateKey, endDate: dateKey, preset: 'custom' })
      const data = await apiRequest<DailyOperationsReportPayload>(
        `/api/board/operations-report/daily?${qs}`,
      )
      setReport(data)
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void handleExportImage()}
          className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          {exporting ? '导出中...' : '导出长图'}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['有效成交金额', formatIntegerMoney(s.validAmountYuan)],
          ['有效成交订单', formatOrderCount(s.soldOrderCount)],
          ['退货单率', formatPercent(s.returnOrderRate)],
          ['客单价', formatIntegerMoney(s.avgOrderAmountYuan)],
          ['成交人数', formatPeopleCount(s.dealUserCount)],
          ['成交率', formatRatePercent(s.dealConversionRate)],
          ['直播时长', formatDuration(s.totalLiveDurationMinutes)],
          ['每小时成交', formatHourly(s.hourlyAmountYuan)],
          ['场观', formatPeopleCount(s.viewSessionCount)],
          ['进房人数', formatPeopleCount(s.joinUserCount)],
          ['平均在线', formatPeopleCount(s.avgOnlineUserCount)],
          ['平均停留', formatStayDurationSeconds(s.avgViewDurationSeconds)],
          ['新增粉丝', formatPeopleCount(s.totalNewFollowerCount)],
          ['粉丝率', formatRatePercent(s.newFollowerRate)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <BusinessInsightCards
        insights={report.businessInsights}
        rangeStartDate={dateKey}
        rangeEndDate={dateKey}
        scope="daily"
        onRefresh={loadReport}
      />

      {report.reportDataQuality?.warnings?.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-medium text-amber-800">数据质量提示</p>
          <ul className="text-xs text-amber-800 space-y-0.5">
            {report.reportDataQuality.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.rankings ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">热卖前 10</h3>
            <p className="mb-2 text-xs text-slate-500">按有效成交金额、成交订单、成交件数排序</p>
            <ProductRankingTable rows={report.rankings.products.hot.items} />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">高退货前 10</h3>
            <p className="mb-2 text-xs text-slate-500">按商品退货订单率排序（成交≥3单为正式榜）</p>
            <ProductRankingTable rows={report.rankings.products.highReturn.items} />
            {report.rankings.products.highReturn.sampleTooSmall?.length ? (
              <div className="mt-2">
                <p className="mb-1 text-xs font-medium text-amber-700">样本不足，仅参考</p>
                <ProductRankingTable rows={report.rankings.products.highReturn.sampleTooSmall} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <RankingQualityBadge
        reliable={report.reportDataQuality?.reliable ?? true}
        confidence={report.reportDataQuality?.reliable ? 'high' : 'insufficient'}
        warnings={report.reportDataQuality?.warnings}
      />

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">主播表现</h3>
        <AnchorOperationsTable rows={report.anchors} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">商品分析</h3>
        <ProductPerformanceTable rows={report.products} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">价格带分析</h3>
        <PriceBandTable rows={report.priceBands} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">售后原因</h3>
        <AfterSalesReasonTable rows={report.afterSalesReasons} />
      </section>

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
