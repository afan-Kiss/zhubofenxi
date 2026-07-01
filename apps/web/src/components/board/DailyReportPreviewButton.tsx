import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toPng } from 'html-to-image'
import { apiRequest } from '../../lib/api'
import {
  DailyReportImageSheet,
  type DailyReportPayload,
} from './DailyReportImageSheet'
import {
  DailyReportShipmentPhotos,
  type DailyReportImageItem,
} from './DailyReportShipmentPhotos'
import { DailyReportZoomPanImage } from './DailyReportZoomPanImage'
import {
  resolveDailyReportImageFetchUrl,
} from '../../lib/daily-report-image-url'
import {
  buildChatGptRawOrderPrompt,
  copyTextToClipboard,
  normalizeAiSuggestionText,
  type DailyReportRawChatGptPayload,
} from './dailyReportFormatters'
import { ViewportModal } from '../ui/ViewportModal'

async function waitForNextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function waitForImagesReady(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve()
            return
          }
          img.onload = () => resolve()
          img.onerror = () => resolve()
        }),
    ),
  )
  await Promise.all(imgs.map((img) => img.decode?.().catch(() => undefined) ?? Promise.resolve()))
}

const CAPTURE_SHEET_WIDTH_PX = 1080
const CAPTURE_PHOTO_HEIGHT_PX = 520

/** 截图前临时拉大画布与照片区域，避免 html-to-image 按小尺寸栅格化 */
async function prepareCaptureLayout(root: HTMLElement): Promise<() => void> {
  const restores: Array<() => void> = []
  const sheet = root.querySelector('[data-daily-report-sheet]') as HTMLElement | null
  if (sheet) {
    const prev = sheet.style.cssText
    sheet.style.width = `${CAPTURE_SHEET_WIDTH_PX}px`
    sheet.style.maxWidth = `${CAPTURE_SHEET_WIDTH_PX}px`
    restores.push(() => {
      sheet.style.cssText = prev
    })
  }
  for (const cell of Array.from(root.querySelectorAll('[data-shipment-photo-cell]'))) {
    const el = cell as HTMLElement
    const prev = el.style.cssText
    el.style.minHeight = `${CAPTURE_PHOTO_HEIGHT_PX}px`
    el.style.height = `${CAPTURE_PHOTO_HEIGHT_PX}px`
    restores.push(() => {
      el.style.cssText = prev
    })
  }
  for (const img of Array.from(root.querySelectorAll('[data-shipment-photo-img]'))) {
    const el = img as HTMLImageElement
    await el.decode().catch(() => undefined)
    const prev = el.style.cssText
    const natural = el.naturalWidth
    const targetWidth = natural > 0 ? Math.min(natural, CAPTURE_SHEET_WIDTH_PX - 48) : CAPTURE_SHEET_WIDTH_PX - 48
    el.style.width = `${targetWidth}px`
    el.style.height = 'auto'
    el.style.maxWidth = '100%'
    el.style.maxHeight = `${CAPTURE_PHOTO_HEIGHT_PX - 16}px`
    el.style.objectFit = 'contain'
    restores.push(() => {
      el.style.cssText = prev
    })
  }
  await waitForNextPaint()
  return () => {
    for (const restore of restores) restore()
  }
}

async function waitForSheetRef(
  ref: React.RefObject<HTMLDivElement | null>,
  timeoutMs = 4000,
): Promise<HTMLDivElement> {
  const started = Date.now()
  while (!ref.current) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('日报组件未就绪，请稍后重试')
    }
    await waitForNextPaint()
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return ref.current
}

async function prefetchShipmentPhotoDataUrls(
  photos: DailyReportImageItem[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const photo of photos) {
    const url = resolveDailyReportImageFetchUrl(photo.publicUrl)
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) continue
      const blob = await res.blob()
      if (!blob.size) continue
      out[photo.id] = await blobToDataUrl(blob)
    } catch {
      // skip broken files
    }
  }
  return out
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

/** 截图前把同域图片转成 data URL，避免 html-to-image 跨域/凭证失败 */
async function inlineSheetImages(root: HTMLElement): Promise<() => void> {
  const restores: Array<() => void> = []
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src')?.trim() ?? ''
    if (!src || src.startsWith('data:')) continue
    try {
      const res = await fetch(src, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const dataUrl = await blobToDataUrl(await res.blob())
      const previous = img.src
      img.src = dataUrl
      img.removeAttribute('crossorigin')
      restores.push(() => {
        img.src = previous
      })
    } catch {
      img.style.visibility = 'hidden'
      restores.push(() => {
        img.style.visibility = ''
      })
    }
  }
  return () => {
    for (const restore of restores) restore()
  }
}

async function renderSheetToPng(node: HTMLElement): Promise<string> {
  const baseOptions = {
    cacheBust: true,
    backgroundColor: '#ffffff',
    skipFonts: true,
  } as const
  for (const pixelRatio of [3, 2, 1]) {
    try {
      return await toPng(node, { ...baseOptions, pixelRatio })
    } catch {
      // try lower ratio on memory / canvas limits
    }
  }
  throw new Error('日报图片生成失败')
}

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
  const captureTokenRef = useRef(0)
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
  const [shipmentPhotos, setShipmentPhotos] = useState<DailyReportImageItem[]>([])
  const [shipmentPhotoDataUrls, setShipmentPhotoDataUrls] = useState<Record<string, string>>({})

  const isSingleDay = startDate.trim() === endDate.trim() && Boolean(startDate.trim())

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2800)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewOpen(false)
  }, [])

  const captureImage = useCallback(async () => {
    const node = await waitForSheetRef(sheetRef)
    await waitForImagesReady(node)
    const restoreImages = await inlineSheetImages(node)
    const restoreLayout = await prepareCaptureLayout(node)
    try {
      await waitForNextPaint()
      await new Promise((resolve) => window.setTimeout(resolve, 160))
      const dataUrl = await renderSheetToPng(node)
      setImageDataUrl(dataUrl)
    } finally {
      restoreLayout()
      restoreImages()
    }
  }, [])

  useEffect(() => {
    if (!pendingCapture || !report) return
    const token = ++captureTokenRef.current
    let cancelled = false
    void (async () => {
      setCapturing(true)
      await waitForNextPaint()
      await new Promise((resolve) => window.setTimeout(resolve, 320))
      if (cancelled || token !== captureTokenRef.current) return
      try {
        await captureImage()
        if (!cancelled && token === captureTokenRef.current) setPreviewOpen(true)
      } catch (e) {
        if (!cancelled && token === captureTokenRef.current) {
          const msg = e instanceof Error ? e.message : '日报图片生成失败，请重试'
          setError(msg.includes('日报') ? msg : `日报图片生成失败：${msg}`)
        }
      } finally {
        if (token === captureTokenRef.current) {
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
      const [data, photoPayload] = await Promise.all([
        apiRequest<DailyReportPayload>(`/board/daily-report?${qs}`),
        apiRequest<{ images: DailyReportImageItem[] }>(
          `/daily-report-images?date=${encodeURIComponent(startDate)}`,
        ).catch(() => ({ images: [] as DailyReportImageItem[] })),
      ])
      if (!data?.summary || !Array.isArray(data?.anchors)) {
        setError('日报数据不完整，请刷新后重试')
        setLoading(false)
        return
      }
      const photos = photoPayload.images ?? []
      const dataUrlMap = await prefetchShipmentPhotoDataUrls(photos)
      setShipmentPhotos(photos)
      setShipmentPhotoDataUrls(dataUrlMap)
      setReport(data)
      setAiSuggestionLines([])
      setImageDataUrl(null)
      setPreviewOpen(false)
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
        `/board/daily-report/raw-chatgpt-data?${qs}`,
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
    report
      ? createPortal(
          <div aria-hidden className="pointer-events-none fixed left-[-9999px] top-0">
            <DailyReportImageSheet
              ref={sheetRef}
              data={report}
              aiSuggestionLines={aiSuggestionLines}
              shipmentPhotos={shipmentPhotos.map((p) => ({
                id: p.id,
                publicUrl: p.publicUrl,
                caption: p.caption,
                dataUrl: shipmentPhotoDataUrls[p.id] ?? null,
              }))}
            />
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
        <DailyReportShipmentPhotos
          reportDate={startDate}
          onImagesChange={(images) => {
            setShipmentPhotos(images)
            void prefetchShipmentPhotoDataUrls(images).then(setShipmentPhotoDataUrls)
          }}
        />
      </div>

      {sheetPortal}

      {previewOpen && imageDataUrl ? (
        <ViewportModal
          open={previewOpen}
          onClose={closePreview}
          zIndexClass="z-[10000]"
          panelClassName="flex max-h-[min(92dvh,calc(100dvh-2rem))] w-[min(760px,calc(100vw-1.5rem))] flex-col overflow-hidden p-4"
          backdropClassName="bg-black/55"
        >
          <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-slate-900">日报预览</p>
            </div>
            <button
              type="button"
              onClick={closePreview}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              关闭
            </button>
          </div>

          <div className="mb-3 flex shrink-0 flex-wrap gap-2">
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

          <DailyReportZoomPanImage
            src={imageDataUrl}
            alt="主播日报"
            className={`min-h-0 flex-1 ${capturing ? 'opacity-40' : 'opacity-100'}`}
          />
          {capturing ? (
            <p className="mt-2 shrink-0 text-center text-xs text-slate-500">正在更新日报图片…</p>
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
