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
  const [report, setReport] = useState<DailyReportPayload | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pendingCapture, setPendingCapture] = useState(false)
  const [shipmentPhotos, setShipmentPhotos] = useState<DailyReportImageItem[]>([])
  const [shipmentPhotoDataUrls, setShipmentPhotoDataUrls] = useState<Record<string, string>>({})

  const isSingleDay = startDate.trim() === endDate.trim() && Boolean(startDate.trim())

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
  }, [pendingCapture, report, captureImage])

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
      setImageDataUrl(null)
      setPreviewOpen(false)
      setPendingCapture(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载日报失败')
      setLoading(false)
    }
  }

  if (!isSingleDay) return null

  const sheetPortal =
    report
      ? createPortal(
          <div aria-hidden className="pointer-events-none fixed left-[-9999px] top-0">
            <DailyReportImageSheet
              ref={sheetRef}
              data={report}
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
    </>
  )
}
