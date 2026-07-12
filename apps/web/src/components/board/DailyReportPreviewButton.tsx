import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiRequest } from '../../lib/api'
import { type DailyReportPayload, DailyReportImageSheet } from './DailyReportImageSheet'
import type { DailyReportImageItem } from './DailyReportShipmentPhotos'
import { DailyReportZoomPanImage } from './DailyReportZoomPanImage'
import { resolveDailyReportImageFetchUrl } from '../../lib/daily-report-image-url'
import {
  ANCHOR_DAILY_REPORT_EXPORT_HOST_ID,
  captureOperationsReportSheet,
  formatReportCaptureError,
  getReportExportHostStyle,
  revokeReportImageUrl,
} from '../../lib/operations-report-image-export'
import { ViewportModal } from '../ui/ViewportModal'

async function waitForNextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function isTrendChartElementReady(el: Element): boolean {
  const trendState = el.getAttribute('data-anchor-trend-chart')
  const compareState = el.getAttribute('data-anchor-trend-compare')
  const state = trendState ?? compareState
  // Empty placeholders never render curves; do not block capture waiting on them.
  if (state === 'empty') return true
  if (state !== 'ready') return false
  const svg = el.querySelector('svg')
  return Boolean(svg && svg.getBoundingClientRect().height > 0)
}

async function waitForTrendChartsReady(root: HTMLElement, timeoutMs = 5000): Promise<void> {
  const charts = Array.from(
    root.querySelectorAll('[data-anchor-trend-chart], [data-anchor-trend-compare]'),
  )
  if (charts.length === 0) return
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (charts.every(isTrendChartElementReady)) break
    await waitForNextPaint()
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  await waitForNextPaint()
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

export async function prefetchShipmentPhotoDataUrls(
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

async function prepareExportPhotosForCapture(root: HTMLElement): Promise<() => void> {
  const restores: Array<() => void> = []
  for (const cell of Array.from(root.querySelectorAll('[data-shipment-photo-cell]'))) {
    const el = cell as HTMLElement
    const img = el.querySelector('[data-shipment-photo-img]') as HTMLImageElement | null
    if (!img) continue
    await img.decode().catch(() => undefined)

    const prevCellStyle = el.style.cssText
    const prevImgStyle = img.style.cssText
    const naturalW = img.naturalWidth
    const naturalH = img.naturalHeight
    if (naturalW > 0 && naturalH > 0) {
      const cellWidth = el.clientWidth > 0 ? el.clientWidth - 8 : 760
      const scale = Math.min(1, cellWidth / naturalW)
      const displayW = Math.round(naturalW * scale)
      const displayH = Math.round(naturalH * scale)
      img.style.width = `${displayW}px`
      img.style.height = `${displayH}px`
      img.style.maxWidth = '100%'
      img.style.maxHeight = '100%'
      img.style.objectFit = 'contain'
    }
    el.style.display = 'flex'
    el.style.alignItems = 'center'
    el.style.justifyContent = 'center'
    restores.push(() => {
      el.style.cssText = prevCellStyle
      img.style.cssText = prevImgStyle
    })
  }
  await waitForNextPaint()
  return () => {
    for (const restore of restores) restore()
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function buildReportDownloadName(startDate: string, title?: string | null): string {
  const safeTitle = (title ?? '主播日报').replace(/[\\/:*?"<>|]/g, '-')
  return `${startDate || 'daily'}-${safeTitle}.png`
}

interface ShipmentPhotoForSheet {
  id: string
  publicUrl: string
  caption: string | null
  dataUrl?: string | null
}

interface Props {
  preset?: string
  startDate: string
  endDate: string
  disabled?: boolean
  shipmentPhotos?: DailyReportImageItem[]
  shipmentPhotoDataUrls?: Record<string, string>
  photosStale?: boolean
  onGenerated?: () => void
}

export const DailyReportPreviewButton: React.FC<Props> = ({
  preset,
  startDate,
  endDate,
  disabled = false,
  shipmentPhotos = [],
  shipmentPhotoDataUrls = {},
  photosStale = false,
  onGenerated,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null)
  const previewBlobRef = useRef<Blob | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const captureTokenRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReportPayload | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pendingCapture, setPendingCapture] = useState(false)

  const isSingleDay = startDate.trim() === endDate.trim() && Boolean(startDate.trim())

  const sheetPhotos: ShipmentPhotoForSheet[] = shipmentPhotos.map((p) => ({
    id: p.id,
    publicUrl: p.publicUrl,
    caption: p.caption,
    dataUrl: shipmentPhotoDataUrls[p.id] ?? null,
  }))

  const closePreview = useCallback(() => {
    setPreviewOpen(false)
  }, [])

  const clearPreview = useCallback(() => {
    revokeReportImageUrl(previewUrlRef.current)
    previewUrlRef.current = null
    setPreviewUrl(null)
    previewBlobRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      revokeReportImageUrl(previewUrlRef.current)
    }
  }, [])

  const captureImage = useCallback(async () => {
    const node = await waitForSheetRef(sheetRef)
    await waitForImagesReady(node)
    await waitForTrendChartsReady(node)
    const restoreImages = await inlineSheetImages(node)
    const restorePhotos = await prepareExportPhotosForCapture(node)
    try {
      await waitForNextPaint()
      await new Promise((resolve) => window.setTimeout(resolve, 200))
      const result = await captureOperationsReportSheet(node)
      revokeReportImageUrl(previewUrlRef.current)
      previewBlobRef.current = result.blob
      previewUrlRef.current = result.objectUrl
      setPreviewUrl(result.objectUrl)
      onGenerated?.()
    } finally {
      restorePhotos()
      restoreImages()
    }
  }, [onGenerated])

  useEffect(() => {
    if (!pendingCapture || !report) return
    const token = ++captureTokenRef.current
    let cancelled = false
    void (async () => {
      setCapturing(true)
      await waitForNextPaint()
      await new Promise((resolve) => window.setTimeout(resolve, 500))
      if (cancelled || token !== captureTokenRef.current) return
      try {
        await captureImage()
        if (!cancelled && token === captureTokenRef.current) setPreviewOpen(true)
      } catch (e) {
        if (!cancelled && token === captureTokenRef.current) {
          const msg = formatReportCaptureError(e)
          setError(msg.includes('长图') || msg.includes('日报') ? msg : `日报图片生成失败：${msg}`)
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
  }, [pendingCapture, report, captureImage])

  const loadAndCapture = async () => {
    if (loading || disabled || capturing) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ startDate, endDate })
      if (preset === 'today' || preset === 'yesterday') {
        qs.set('preset', preset)
      } else {
        qs.set('preset', 'custom')
      }
      const data = await apiRequest<DailyReportPayload>(`/board/daily-report?${qs}`, {
        retryOnGateway: 2,
      })
      if (!data?.summary || !Array.isArray(data?.anchors)) {
        setError('日报数据不完整，请刷新后重试')
        setLoading(false)
        return
      }
      clearPreview()
      setReport(data)
      setPreviewOpen(false)
      setPendingCapture(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载日报失败')
      setLoading(false)
    }
  }

  if (!isSingleDay) return null

  const sheetWidthPx = sheetPhotos.some((p) => p.dataUrl) ? 960 : 700

  const sheetPortal =
    report
      ? createPortal(
          <div
            id={ANCHOR_DAILY_REPORT_EXPORT_HOST_ID}
            data-testid="anchor-daily-report-export-host"
            aria-hidden
            className="pointer-events-none"
            style={getReportExportHostStyle(sheetWidthPx)}
          >
            <DailyReportImageSheet ref={sheetRef} data={report} shipmentPhotos={sheetPhotos} />
          </div>,
          document.body,
        )
      : null

  const busy = loading || capturing

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void loadAndCapture()}
          className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '生成中...' : previewUrl ? '重新生成日报' : '查看日报'}
        </button>
        {previewUrl && !busy ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            再次预览
          </button>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      {photosStale ? (
        <p className="mt-2 text-xs text-amber-700">
          发货照片已更新，请重新生成日报后再预览或保存。
        </p>
      ) : null}

      {sheetPortal}

      {previewOpen && previewUrl ? (
        <ViewportModal
          open={previewOpen}
          onClose={closePreview}
          zIndexClass="z-[10000]"
          panelClassName="flex max-h-[min(92dvh,calc(100dvh-2rem))] w-[min(1200px,calc(100vw-1.5rem))] flex-col overflow-hidden p-4"
          backdropClassName="bg-black/55"
        >
          <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-slate-900">日报预览</p>
              <p className="mt-0.5 text-xs text-slate-500">{report?.title ?? startDate}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const blob = previewBlobRef.current
                  if (!blob) return
                  downloadBlob(blob, buildReportDownloadName(startDate, report?.title))
                }}
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-sm font-medium text-rose-700 hover:bg-rose-100"
              >
                保存图片
              </button>
              <button
                type="button"
                onClick={closePreview}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                关闭
              </button>
            </div>
          </div>

          <DailyReportZoomPanImage
            src={previewUrl}
            alt="主播日报"
            imageTestId="anchor-daily-report-preview-img"
            className={`min-h-0 flex-1 ${capturing ? 'opacity-40' : 'opacity-100'}`}
          />
          {capturing ? (
            <p className="mt-2 shrink-0 text-center text-xs text-slate-500">正在更新日报图片…</p>
          ) : null}
        </ViewportModal>
      ) : null}
    </>
  )
}
