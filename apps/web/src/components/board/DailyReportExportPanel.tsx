import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toPng } from 'html-to-image'
import { apiRequest } from '../../lib/api'
import {
  buildAnchorDrawerSummaryText,
  formatReportDateLabel,
} from '../../lib/anchor-drawer-summary'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  DailyReportAnchorSection,
  type DailyReportSectionData,
} from './DailyReportAnchorSection'

interface DailyReportPayload {
  startDate: string
  endDate: string
  sections: DailyReportSectionData[]
}

interface Props {
  preset?: string
  startDate: string
  endDate: string
  disabled?: boolean
}

export const DailyReportExportPanel: React.FC<Props> = ({
  preset,
  startDate,
  endDate,
  disabled = false,
}) => {
  const { formatMoney } = useAmountDisplay()
  const sheetRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReportPayload | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pendingDownload, setPendingDownload] = useState(false)

  const isSingleDay = startDate.trim() === endDate.trim() && Boolean(startDate)

  const buildHeadlines = useCallback(
    (payload: DailyReportPayload) =>
      payload.sections
        .map((section) => {
          const stats = section.stats
          if (!stats) return ''
          const shipped =
            Number(stats.validSalesAmount ?? 0) || Number(stats.effectiveGmv ?? 0)
          return buildAnchorDrawerSummaryText({
            startDate: payload.startDate,
            endDate: payload.endDate,
            anchorName: section.anchorName,
            orderCount: Number(stats.orderCount ?? 0),
            refundOrderCount:
              Number(stats.returnCount ?? 0) || Number(stats.refundOrderCount ?? 0),
            shippedOrderAmountYuan: shipped,
            formatMoney,
          })
        })
        .filter(Boolean),
    [formatMoney],
  )

  const fetchReport = useCallback(async () => {
    const qs = new URLSearchParams({ startDate, endDate })
    if (preset) qs.set('preset', preset)
    return apiRequest<DailyReportPayload>(`/api/board/daily-report?${qs}`)
  }, [startDate, endDate, preset])

  const downloadImage = useCallback(async () => {
    if (!sheetRef.current || !report) return
    const dateKey = startDate.replace(/-/g, '')
    const blobUrl = await toPng(sheetRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })
    const link = document.createElement('a')
    link.download = `主播日报-${dateKey}.png`
    link.href = blobUrl
    link.click()
  }, [report, startDate])

  useEffect(() => {
    if (!pendingDownload || !report || !sheetRef.current) return
    let cancelled = false
    void (async () => {
      await new Promise((r) => window.setTimeout(r, 300))
      if (cancelled || !sheetRef.current) return
      try {
        await downloadImage()
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '图片导出失败')
        }
      } finally {
        if (!cancelled) setPendingDownload(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingDownload, report, downloadImage])

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchReport()
      if (payload.sections.length === 0) {
        setError('当前日期暂无主播业绩数据')
        setReport(null)
        setPreviewOpen(false)
        return
      }
      setReport(payload)
      setPreviewOpen(true)
      setPendingDownload(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载日报失败')
    } finally {
      setLoading(false)
    }
  }

  if (!isSingleDay) return null

  const headlines = report ? buildHeadlines(report) : []
  const dateTitle = formatReportDateLabel(startDate, endDate)

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">日报长图</p>
          <p className="mt-0.5 text-xs text-slate-500">
            按当前单日范围生成一张图片，包含各主播汇总、直播时段与订单明细，方便转发汇报。
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void handleGenerate()}
          className="shrink-0 rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '生成中…' : '生成日报图片'}
        </button>
        {report && previewOpen ? (
          <button
            type="button"
            onClick={() => void downloadImage()}
            className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            再次下载
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {report && previewOpen
        ? createPortal(
            <div className="pointer-events-none fixed left-[-9999px] top-0 z-[-1]">
              <div
                ref={sheetRef}
                className="w-[420px] bg-white p-4"
                style={{ fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif' }}
              >
                <div className="mb-4 space-y-2">
                  <h2 className="text-center text-base font-semibold text-slate-900">
                    {dateTitle}日报
                  </h2>
                  {headlines.map((line) => (
                    <p key={line} className="text-[13px] leading-relaxed text-slate-800">
                      {line}
                    </p>
                  ))}
                </div>
                <div className="space-y-4">
                  {report.sections.map((section) => (
                    <DailyReportAnchorSection
                      key={section.anchorId || section.anchorName}
                      startDate={report.startDate}
                      endDate={report.endDate}
                      section={section}
                    />
                  ))}
                </div>
                <p className="mt-4 text-center text-[10px] text-slate-400">
                  数据来源：本地已同步订单 · 支付基数低于 29 元不计入 · 发货单不含已关闭/售后完成无效单
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
