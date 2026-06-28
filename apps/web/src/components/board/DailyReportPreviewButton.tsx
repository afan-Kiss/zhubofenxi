import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toPng } from 'html-to-image'
import { apiRequest } from '../../lib/api'
import {
  DailyReportImageSheet,
  type DailyReportPayload,
} from './DailyReportImageSheet'
import {
  buildChatGptRawOrderPrompt,
  copyTextToClipboard,
  normalizeAiSuggestionText,
  type DailyReportRawChatGptPayload,
} from './dailyReportFormatters'
import { ViewportModal } from '../ui/ViewportModal'

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
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReportPayload | null>(null)
  const [aiSuggestionLines, setAiSuggestionLines] = useState<string[]>([])
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [aiInputOpen, setAiInputOpen] = useState(false)
  const [aiDraft, setAiDraft] = useState('')
  const [clipboardFallbackText, setClipboardFallbackText] = useState<string | null>(null)
  const [copyingRawData, setCopyingRawData] = useState(false)
  const [pendingCapture, setPendingCapture] = useState(false)

  const isSingleDay = startDate.trim() === endDate.trim() && Boolean(startDate.trim())

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2800)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewOpen(false)
  }, [])

  const captureImage = useCallback(async () => {
    if (!sheetRef.current) throw new Error('日报图片生成失败，请重试')
    const dataUrl = await toPng(sheetRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })
    setImageDataUrl(dataUrl)
  }, [])

  useEffect(() => {
    if (!pendingCapture || !report) return
    let cancelled = false
    void (async () => {
      setCapturing(true)
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      if (cancelled) return
      try {
        await captureImage()
        if (!cancelled) setPreviewOpen(true)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '日报图片生成失败，请重试')
        }
      } finally {
        if (!cancelled) {
          setPendingCapture(false)
          setCapturing(false)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingCapture, report, aiSuggestionLines, captureImage])

  const handleViewReport = async () => {
    if (loading || disabled || capturing) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ startDate, endDate })
      if (preset) qs.set('preset', preset)
      const data = await apiRequest<DailyReportPayload>(`/api/board/daily-report?${qs}`)
      setReport(data)
      setAiSuggestionLines([])
      setImageDataUrl(null)
      setPendingCapture(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载日报失败')
      setLoading(false)
    }
  }

  const openAiInputModal = (prefill = '') => {
    setAiDraft(prefill || aiSuggestionLines.join('\n'))
    setClipboardFallbackText(null)
    setAiInputOpen(true)
  }

  const handleCopyForChatGpt = async () => {
    if (!report || copyingRawData) return
    setCopyingRawData(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ startDate, endDate })
      if (preset) qs.set('preset', preset)
      const rawData = await apiRequest<DailyReportRawChatGptPayload>(
        `/api/board/daily-report/raw-chatgpt-data?${qs}`,
      )
      const prompt = buildChatGptRawOrderPrompt(rawData)
      const copied = await copyTextToClipboard(prompt)
      if (copied) {
        showToast('已复制当前时间段原始订单数据，请粘贴给 ChatGPT 分析。')
        setClipboardFallbackText(null)
      } else {
        setClipboardFallbackText(prompt)
        showToast('复制失败，请手动复制弹窗里的数据。')
      }
      openAiInputModal()
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载小红书原始订单数据失败')
    } finally {
      setCopyingRawData(false)
    }
  }

  const handleApplyAiSuggestion = async () => {
    const normalized = normalizeAiSuggestionText(aiDraft)
    if (normalized.length === 0) {
      showToast('请先粘贴 AI 建议')
      return
    }
    setAiSuggestionLines(normalized)
    setAiInputOpen(false)
    setPendingCapture(true)
    showToast('AI建议已加入日报图片')
  }

  if (!isSingleDay) return null

  const sheetPortal =
    report && (pendingCapture || previewOpen)
      ? createPortal(
          <div className="pointer-events-none fixed left-[-9999px] top-0 z-[-1]">
            <DailyReportImageSheet
              ref={sheetRef}
              data={report}
              aiSuggestionLines={aiSuggestionLines}
            />
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        type="button"
        disabled={disabled || loading || capturing}
        onClick={() => void handleViewReport()}
        className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading || capturing ? '生成中...' : '查看日报'}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {toast ? <p className="text-sm text-emerald-700">{toast}</p> : null}

      {sheetPortal}

      {previewOpen && imageDataUrl ? (
        <ViewportModal
          open={previewOpen}
          onClose={closePreview}
          zIndexClass="z-[10000]"
          panelClassName="max-h-[min(92dvh,calc(100dvh-2rem))] w-[min(760px,calc(100vw-1.5rem))] overflow-auto p-4"
          backdropClassName="bg-black/55"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-slate-900">日报预览</p>
              <p className="mt-1 text-xs text-slate-500">右键图片可复制</p>
            </div>
            <button
              type="button"
              onClick={closePreview}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              关闭
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={copyingRawData}
              onClick={() => void handleCopyForChatGpt()}
              className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copyingRawData ? '复制中...' : '复制原始数据给 ChatGPT'}
            </button>
            {aiSuggestionLines.length > 0 ? (
              <button
                type="button"
                onClick={() => openAiInputModal()}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                重新填写 AI 建议
              </button>
            ) : null}
          </div>

          <img
            src={imageDataUrl}
            alt="主播日报"
            className={`mx-auto block max-w-full rounded-xl border border-slate-100 shadow-sm transition-opacity ${
              capturing ? 'opacity-40' : 'opacity-100'
            }`}
          />
          {capturing ? (
            <p className="mt-2 text-center text-xs text-slate-500">正在更新日报图片…</p>
          ) : null}
        </ViewportModal>
      ) : null}

      <ViewportModal
        open={aiInputOpen}
        onClose={() => setAiInputOpen(false)}
        zIndexClass="z-[10001]"
        panelClassName="w-full max-w-lg overflow-visible p-5"
        backdropClassName="bg-black/45"
      >
        <p className="text-base font-semibold text-slate-900">粘贴 ChatGPT 返回的 AI 建议</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          已复制当前时间段的小红书原始订单业务数据，请发送给 ChatGPT，然后把返回的 AI建议粘贴到这里。
        </p>
        {clipboardFallbackText ? (
          <textarea
            readOnly
            value={clipboardFallbackText}
            className="mt-3 h-28 w-full resize-none rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-xs leading-5 text-slate-700"
          />
        ) : null}
        <textarea
          value={aiDraft}
          onChange={(e) => setAiDraft(e.target.value)}
          placeholder="粘贴 ChatGPT 返回的 AI 建议..."
          className="mt-3 h-40 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm leading-6 text-slate-800 outline-none focus:border-rose-300"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setAiInputOpen(false)}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleApplyAiSuggestion()}
            className="rounded-full border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            应用到日报
          </button>
        </div>
      </ViewportModal>
    </>
  )
}
