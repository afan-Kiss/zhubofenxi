import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toPng } from 'html-to-image'
import { apiRequest } from '../../lib/api'
import {
  DailyReportImageSheet,
  type DailyReportPayload,
} from './DailyReportImageSheet'

interface Props {
  preset?: string
  startDate: string
  endDate: string
  disabled?: boolean
}

export const DailyReportPreviewButton: React.FC<Props> = ({
  preset,
  startDate,
  endDate,
  disabled = false,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReportPayload | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [pendingCapture, setPendingCapture] = useState(false)

  const isSingleDay = startDate.trim() === endDate.trim() && Boolean(startDate.trim())

  const closeModal = useCallback(() => {
    setOpen(false)
    setPendingCapture(false)
  }, [])

  const captureImage = useCallback(async () => {
    if (!sheetRef.current) throw new Error('日报图片生成失败，请重试')
    const dataUrl = await toPng(sheetRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })
    setImageDataUrl(dataUrl)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!pendingCapture || !report) return
    let cancelled = false
    void (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      if (cancelled) return
      try {
        await captureImage()
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '日报图片生成失败，请重试')
        }
      } finally {
        if (!cancelled) {
          setPendingCapture(false)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingCapture, report, captureImage])

  const handleClick = async () => {
    if (loading || disabled) return
    setLoading(true)
    setError(null)
    setImageDataUrl(null)
    try {
      const qs = new URLSearchParams({ startDate, endDate })
      if (preset) qs.set('preset', preset)
      const payload = await apiRequest<DailyReportPayload>(`/api/board/daily-report?${qs}`)
      if (payload.anchors.length === 0) {
        setError('当前日期暂无主播业绩数据')
        setReport(null)
        setLoading(false)
        return
      }
      setReport(payload)
      setPendingCapture(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载日报失败')
      setLoading(false)
    }
  }

  if (!isSingleDay) return null

  return (
    <>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => void handleClick()}
        className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? '生成中...' : '查看日报'}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {report && pendingCapture
        ? createPortal(
            <div className="pointer-events-none fixed left-[-9999px] top-0 z-[-1]">
              <DailyReportImageSheet ref={sheetRef} data={report} />
            </div>,
            document.body,
          )
        : null}

      {open && imageDataUrl
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 p-4"
              onClick={closeModal}
            >
              <div
                className="relative max-h-[92vh] w-full max-w-[760px] overflow-auto rounded-2xl bg-white p-4 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900">日报预览</p>
                    <p className="mt-1 text-xs text-slate-500">右键图片可复制</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    关闭
                  </button>
                </div>
                <img
                  src={imageDataUrl}
                  alt="主播日报"
                  className="mx-auto block max-w-full rounded-xl border border-slate-100 shadow-sm"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
