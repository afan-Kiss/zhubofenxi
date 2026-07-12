import React, { useEffect, useRef, useState } from 'react'
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
import {
  OPERATIONS_REPORT_EXPORT_HOST_ID,
  captureOperationsReportSheet,
  formatReportCaptureError,
  getOperationsReportExportHostStyle,
  logReportCaptureDiagnostics,
  measureReportSheet,
  revokeReportImageUrl,
  waitForNextPaint,
} from '../../lib/operations-report-image-export'

interface Props {
  dateKey: string
  onLoadingChange?: (loading: boolean) => void
}

type DailyLoadResult = {
  report: DailyOperationsReportPayload
  cacheMeta: WithOperationsReportCacheMeta<DailyOperationsReportPayload>['cacheMeta']
  cacheWarning: string | null
}

type PreviewMeta = {
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
  fileSize: number
  pixelRatio: number
  compatNote: string | null
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function waitForSheetRef(
  ref: React.RefObject<HTMLDivElement | null>,
  timeoutMs = 4_000,
): Promise<HTMLDivElement> {
  const started = Date.now()
  while (!ref.current) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('长图组件未就绪，请刷新后重试')
    }
    await waitForNextPaint()
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return ref.current
}

export const OperationsDailyReport: React.FC<Props> = ({ dateKey, onLoadingChange }) => {
  const sheetRef = useRef<HTMLDivElement>(null)
  const previewBlobRef = useRef<Blob | null>(null)
  const topLimit = useChartTopLimit()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta | null>(null)
  const [previewImageError, setPreviewImageError] = useState<string | null>(null)
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false)
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

  const clearPreview = () => {
    revokeReportImageUrl(previewUrl)
    setPreviewUrl(null)
    setPreviewMeta(null)
    setPreviewImageError(null)
    setPreviewImageLoaded(false)
    previewBlobRef.current = null
  }

  const handleExportImage = async () => {
    if (!report) {
      setExportError('数据还没加载完，请稍后再导出长图')
      return
    }
    if (refreshing) {
      setExportError('正在刷新数据，请稍后再导出长图')
      return
    }

    setExporting(true)
    setExportError(null)
    clearPreview()

    try {
      const node = await waitForSheetRef(sheetRef)
      const preDim = measureReportSheet(node)
      logReportCaptureDiagnostics('pre-capture-sheet', {
        width: preDim.width,
        height: preDim.height,
        rectWidth: preDim.rectWidth,
        rectHeight: preDim.rectHeight,
      } as Parameters<typeof logReportCaptureDiagnostics>[1])

      const result = await captureOperationsReportSheet(node)
      previewBlobRef.current = result.blob
      setPreviewUrl(result.objectUrl)
      setPreviewMeta({
        width: result.width,
        height: result.height,
        naturalWidth: result.diagnostics.naturalWidth,
        naturalHeight: result.diagnostics.naturalHeight,
        fileSize: result.blob.size,
        pixelRatio: result.pixelRatio,
        compatNote: result.compatNote,
      })
      setPreviewImageLoaded(false)
      setPreviewImageError(null)
    } catch (err) {
      console.error('[operations-report-export] capture failed', err)
      const message = formatReportCaptureError(err)
      setExportError(message)
      if (err instanceof Error) {
        logReportCaptureDiagnostics('capture-failed', {
          errorName: err.name,
          errorMessage: err.message,
        })
      }
    } finally {
      setExporting(false)
    }
  }

  const handleClosePreview = () => {
    clearPreview()
  }

  const handleDownloadImage = () => {
    const blob = previewBlobRef.current
    if (!blob || !previewImageLoaded) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `运营日报-${dateKey}.png`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
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
  const exportHostStyle = getOperationsReportExportHostStyle()

  return (
    <OperationsReportLoadShell loading={loading} refreshing={refreshing}>
    <div className="space-y-4 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>
          <OperationsReportCacheHint cacheMeta={cacheMeta} cacheWarning={cacheWarning} className="mt-1" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="ops-daily-export-btn"
            disabled={exporting || refreshing || !report}
            onClick={() => void handleExportImage()}
            className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {exporting ? '导出中...' : refreshing ? '刷新中...' : '导出长图'}
          </button>
        </div>
      </div>

      {exportError ? (
        <p
          data-testid="ops-daily-export-error"
          className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {exportError}
        </p>
      ) : null}

      <OperationsCoreMetrics
        core={
          <>
            <OperationsMetricDrillCard
              label="全店有效成交"
              value={formatIntegerMoney(s.validAmountYuan)}
              drillRequest={{ ...drillBase, target: 'summary_valid_amount' }}
            />
            <OperationsMetricDrillCard
              label="有效成交订单"
              value={formatOrderCount(s.soldOrderCount)}
              drillRequest={{ ...drillBase, target: 'summary_orders' }}
            />
            <OperationsMetricDrillCard
              label="全店无效/刷单"
              value={formatOrderCount(s.invalidOrderCount)}
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
              footer={
                <p className="mt-1 text-[11px] leading-snug text-slate-500">
                  每小时成交 = 全店有效成交 ÷ 全部直播时长
                  {(s.unassignedLiveSessionCount ?? 0) > 0
                    ? '（含未匹配排班的场次）'
                    : ''}
                </p>
              }
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
            <div
              id={OPERATIONS_REPORT_EXPORT_HOST_ID}
              aria-hidden
              className="pointer-events-none"
              style={exportHostStyle}
            >
              <OperationsReportImageSheet ref={sheetRef} data={report} />
            </div>,
            document.body,
          )
        : null}

      {previewUrl ? (
        <ViewportModal
          open={Boolean(previewUrl)}
          onClose={handleClosePreview}
          zIndexClass="z-[10000]"
          panelClassName="max-h-[min(92dvh,calc(100dvh-2rem))] w-[min(760px,calc(100vw-1.5rem))] overflow-auto p-4"
          backdropClassName="bg-black/55"
        >
          <div
            data-testid="ops-daily-export-preview"
            className="mb-3 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">长图预览（可保存发群）</p>
              {previewMeta ? (
                <p className="mt-0.5 text-xs text-slate-500">
                  {previewMeta.naturalWidth} × {previewMeta.naturalHeight} px ·{' '}
                  {formatFileSize(previewMeta.fileSize)}
                  {previewMeta.compatNote ? ` · ${previewMeta.compatNote}` : ''}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="ops-daily-export-download"
                disabled={!previewImageLoaded || Boolean(previewImageError)}
                onClick={handleDownloadImage}
                className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下载长图
              </button>
              <button
                type="button"
                data-testid="ops-daily-export-close"
                onClick={handleClosePreview}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                关闭
              </button>
            </div>
          </div>

          {previewImageError ? (
            <p
              data-testid="ops-daily-export-preview-error"
              className="rounded-xl border border-red-100 bg-red-50 px-3 py-4 text-sm text-red-700"
            >
              预览加载失败：{previewImageError}
            </p>
          ) : (
            <img
              data-testid="ops-daily-export-preview-img"
              src={previewUrl}
              alt="运营日报"
              className="max-w-full rounded-xl"
              onLoad={(e) => {
                const img = e.currentTarget
                setPreviewImageLoaded(true)
                setPreviewImageError(null)
                setPreviewMeta((prev) =>
                  prev
                    ? {
                        ...prev,
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                      }
                    : prev,
                )
              }}
              onError={() => {
                setPreviewImageLoaded(false)
                setPreviewImageError('图片无法在浏览器中显示，请尝试重新导出')
              }}
            />
          )}
        </ViewportModal>
      ) : null}
    </div>
    </OperationsReportLoadShell>
  )
}
