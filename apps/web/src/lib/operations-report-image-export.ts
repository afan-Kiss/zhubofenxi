import type { CSSProperties } from 'react'
import { toBlob } from 'html-to-image'

export const REPORT_SHEET_WIDTH_PX = 720
export const MIN_EXPORT_WIDTH = 600
export const MIN_EXPORT_HEIGHT = 300
/** Chrome 常见 Canvas 面积上限 */
const MAX_CANVAS_AREA = 268_435_456
const MAX_CANVAS_EDGE = 16_384

export type ReportSheetDimensions = {
  width: number
  height: number
  scrollWidth: number
  scrollHeight: number
  rectWidth: number
  rectHeight: number
}

export type ReportImageCaptureDiagnostics = {
  width: number
  height: number
  pixelRatio: number
  dataUrlLength?: number
  blobSize: number
  naturalWidth: number
  naturalHeight: number
  whiteRatio: number
  usedCompatMode: boolean
  userAgent: string
}

export type ReportImageCaptureResult = {
  blob: Blob
  objectUrl: string
  width: number
  height: number
  pixelRatio: number
  usedCompatMode: boolean
  compatNote: string | null
  diagnostics: ReportImageCaptureDiagnostics
}

export type BlankImageDetectResult = {
  blank: boolean
  whiteRatio: number
  naturalWidth: number
  naturalHeight: number
  reason?: string
}

export class ReportImageCaptureError extends Error {
  readonly diagnostics: Partial<ReportImageCaptureDiagnostics> & {
    errorName?: string
    errorMessage?: string
  }

  constructor(message: string, diagnostics: ReportImageCaptureError['diagnostics'] = {}) {
    super(message)
    this.name = 'ReportImageCaptureError'
    this.diagnostics = diagnostics
  }
}

export const OPERATIONS_REPORT_EXPORT_HOST_ID = 'operations-report-export-host'
export const ANCHOR_DAILY_REPORT_EXPORT_HOST_ID = 'anchor-daily-report-export-host'

const EXPORT_HOST_OFFSCREEN_LEFT_PX = -12_000

export function getReportExportHostStyle(widthPx: number): CSSProperties {
  return {
    position: 'fixed',
    left: EXPORT_HOST_OFFSCREEN_LEFT_PX,
    top: 0,
    width: widthPx,
    zIndex: -1,
    pointerEvents: 'none',
    display: 'block',
    visibility: 'visible',
    opacity: 1,
    overflow: 'visible',
  }
}

export function getOperationsReportExportHostStyle(): CSSProperties {
  return getReportExportHostStyle(REPORT_SHEET_WIDTH_PX)
}

export async function waitForNextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function waitForImagesReady(root: HTMLElement, timeoutMs = 8_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const imgs = Array.from(root.querySelectorAll('img'))
    const pending = imgs.filter((img) => !img.complete || img.naturalWidth <= 0)
    if (pending.length === 0) {
      await Promise.all(imgs.map((img) => img.decode?.().catch(() => undefined) ?? Promise.resolve()))
      return
    }
    await waitForNextPaint()
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  throw new ReportImageCaptureError('截图区域内图片加载超时', { errorName: 'ImageLoadTimeout' })
}

export function measureReportSheet(node: HTMLElement): ReportSheetDimensions {
  const rect = node.getBoundingClientRect()
  const scrollWidth = Math.ceil(node.scrollWidth)
  const scrollHeight = Math.ceil(node.scrollHeight)
  return {
    width: Math.max(scrollWidth, Math.ceil(rect.width)),
    height: Math.max(scrollHeight, Math.ceil(rect.height)),
    scrollWidth,
    scrollHeight,
    rectWidth: Math.ceil(rect.width),
    rectHeight: Math.ceil(rect.height),
  }
}

function assertSheetDimensions(dim: ReportSheetDimensions): void {
  if (dim.width < MIN_EXPORT_WIDTH || dim.height < MIN_EXPORT_HEIGHT) {
    throw new ReportImageCaptureError(
      `长图生成失败：截图区域尺寸异常（${dim.width}×${dim.height}）`,
      {
        width: dim.width,
        height: dim.height,
        errorName: 'InvalidDimensions',
      },
    )
  }
}

function assertSheetHasContent(node: HTMLElement): void {
  const text = (node.innerText ?? '').replace(/\s+/g, '').trim()
  if (!text) {
    throw new ReportImageCaptureError('长图生成失败：截图区域文本为空', {
      errorName: 'EmptyContent',
    })
  }
}

export async function waitForReportSheetReady(
  node: HTMLElement,
  options?: { timeoutMs?: number },
): Promise<ReportSheetDimensions> {
  const timeoutMs = options?.timeoutMs ?? 12_000
  const started = Date.now()

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready
  }
  await waitForNextPaint()
  await waitForNextPaint()

  while (Date.now() - started < timeoutMs) {
    await waitForImagesReady(node, Math.max(1_000, timeoutMs - (Date.now() - started)))
    const dim = measureReportSheet(node)
    if (dim.scrollWidth > 0 && dim.scrollHeight > 0) {
      assertSheetHasContent(node)
      assertSheetDimensions(dim)
      return dim
    }
    await waitForNextPaint()
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }

  const dim = measureReportSheet(node)
  assertSheetDimensions(dim)
  return dim
}

export function computeSafePixelRatio(
  width: number,
  height: number,
  preferred = 2,
): { pixelRatio: number; usedCompatMode: boolean; compatNote: string | null } {
  const candidates = [preferred, 1.5, 1]
  for (const pixelRatio of candidates) {
    const canvasW = width * pixelRatio
    const canvasH = height * pixelRatio
    const area = canvasW * canvasH
    if (
      area <= MAX_CANVAS_AREA &&
      canvasW <= MAX_CANVAS_EDGE &&
      canvasH <= MAX_CANVAS_EDGE
    ) {
      const usedCompatMode = pixelRatio < preferred
      return {
        pixelRatio,
        usedCompatMode,
        compatNote: usedCompatMode ? '日报内容较长，已使用兼容清晰度导出' : null,
      }
    }
  }
  throw new ReportImageCaptureError('长图生成失败：浏览器 Canvas 尺寸超过限制', {
    width,
    height,
    errorName: 'CanvasLimitExceeded',
  })
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

/** 多区域网格采样，避免日报白底误判 */
export async function detectBlankImageBlob(blob: Blob): Promise<BlankImageDetectResult> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImageFromUrl(url)
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight

    if (naturalWidth < MIN_EXPORT_WIDTH || naturalHeight < MIN_EXPORT_HEIGHT) {
      return {
        blank: true,
        whiteRatio: 1,
        naturalWidth,
        naturalHeight,
        reason: 'dimensions_too_small',
      }
    }

    const canvas = document.createElement('canvas')
    const sampleW = 120
    const sampleH = 120
    canvas.width = sampleW
    canvas.height = sampleH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return {
        blank: true,
        whiteRatio: 1,
        naturalWidth,
        naturalHeight,
        reason: 'canvas_unavailable',
      }
    }

    const regions = [
      { sx: 0, sy: 0 },
      { sx: Math.max(0, naturalWidth * 0.25), sy: Math.max(0, naturalHeight * 0.1) },
      { sx: Math.max(0, naturalWidth * 0.5), sy: Math.max(0, naturalHeight * 0.35) },
      { sx: Math.max(0, naturalWidth * 0.15), sy: Math.max(0, naturalHeight * 0.65) },
      { sx: Math.max(0, naturalWidth * 0.4), sy: Math.max(0, naturalHeight - sampleH) },
    ]

    let whiteOrTransparent = 0
    let total = 0

    for (const region of regions) {
      ctx.clearRect(0, 0, sampleW, sampleH)
      ctx.drawImage(
        img,
        region.sx,
        region.sy,
        sampleW,
        sampleH,
        0,
        0,
        sampleW,
        sampleH,
      )
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data
      const step = 6
      for (let y = 0; y < sampleH; y += step) {
        for (let x = 0; x < sampleW; x += step) {
          const i = (y * sampleW + x) * 4
          const r = data[i] ?? 255
          const g = data[i + 1] ?? 255
          const b = data[i + 2] ?? 255
          const a = data[i + 3] ?? 255
          total++
          if (a < 12 || (r > 248 && g > 248 && b > 248)) {
            whiteOrTransparent++
          }
        }
      }
    }

    const whiteRatio = total > 0 ? whiteOrTransparent / total : 1
    return {
      blank: whiteRatio > 0.99,
      whiteRatio,
      naturalWidth,
      naturalHeight,
      reason: whiteRatio > 0.99 ? 'blank_image' : undefined,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function withCaptureTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

async function renderSheetToBlob(
  node: HTMLElement,
  dim: ReportSheetDimensions,
  pixelRatio: number,
): Promise<Blob> {
  const width = dim.width
  const height = dim.height
  const blob = await withCaptureTimeout(
    toBlob(node, {
      cacheBust: true,
      pixelRatio,
      backgroundColor: '#ffffff',
      width,
      height,
      canvasWidth: Math.ceil(width * pixelRatio),
      canvasHeight: Math.ceil(height * pixelRatio),
      skipFonts: true,
      style: {
        transform: 'scale(1)',
        width: `${width}px`,
        height: `${height}px`,
      },
    }),
    45_000,
    '长图生成超时，请稍后重试',
  )

  if (!blob || blob.size < 1_024) {
    throw new ReportImageCaptureError('长图生成失败：PNG 数据为空或过小', {
      width,
      height,
      pixelRatio,
      blobSize: blob?.size ?? 0,
      errorName: 'EmptyBlob',
    })
  }

  return blob
}

export function revokeReportImageUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

export function formatReportCaptureError(
  err: unknown,
  diag: Partial<ReportImageCaptureDiagnostics> = {},
): string {
  if (err instanceof ReportImageCaptureError) {
    return err.message
  }
  if (err instanceof Error) {
    if (err.message.includes('Canvas') || err.message.includes('canvas')) {
      return '长图生成失败：浏览器 Canvas 尺寸超过限制'
    }
    if (err.message.includes('超时')) {
      return err.message
    }
    const w = diag.width
    const h = diag.height
    if (typeof w === 'number' && typeof h === 'number' && (w < MIN_EXPORT_WIDTH || h < MIN_EXPORT_HEIGHT)) {
      return `长图生成失败：截图区域尺寸异常（${w}×${h}）`
    }
    return `长图生成失败：${err.message}`
  }
  return '长图生成失败，请刷新后重试'
}

export function logReportCaptureDiagnostics(
  label: string,
  diag: Partial<ReportImageCaptureDiagnostics> & { errorName?: string; errorMessage?: string },
): void {
  console.info(`[operations-report-export] ${label}`, {
    ...diag,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  })
}

type CaptureAttemptOptions = {
  pixelRatio: number
  usedCompatMode: boolean
  compatNote: string | null
}

async function captureOnce(
  node: HTMLElement,
  dim: ReportSheetDimensions,
  attempt: CaptureAttemptOptions,
): Promise<ReportImageCaptureResult> {
  const blob = await renderSheetToBlob(node, dim, attempt.pixelRatio)
  const blank = await detectBlankImageBlob(blob)
  if (blank.blank) {
    throw new ReportImageCaptureError('长图生成失败：检测到空白图片', {
      width: dim.width,
      height: dim.height,
      pixelRatio: attempt.pixelRatio,
      blobSize: blob.size,
      naturalWidth: blank.naturalWidth,
      naturalHeight: blank.naturalHeight,
      whiteRatio: blank.whiteRatio,
      usedCompatMode: attempt.usedCompatMode,
      errorName: 'BlankImage',
      errorMessage: blank.reason,
    })
  }

  const objectUrl = URL.createObjectURL(blob)
  const diagnostics: ReportImageCaptureDiagnostics = {
    width: dim.width,
    height: dim.height,
    pixelRatio: attempt.pixelRatio,
    blobSize: blob.size,
    naturalWidth: blank.naturalWidth,
    naturalHeight: blank.naturalHeight,
    whiteRatio: blank.whiteRatio,
    usedCompatMode: attempt.usedCompatMode,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  }

  return {
    blob,
    objectUrl,
    width: dim.width,
    height: dim.height,
    pixelRatio: attempt.pixelRatio,
    usedCompatMode: attempt.usedCompatMode,
    compatNote: attempt.compatNote,
    diagnostics,
  }
}

export async function captureOperationsReportSheet(
  node: HTMLElement,
): Promise<ReportImageCaptureResult> {
  const dim = await waitForReportSheetReady(node)
  logReportCaptureDiagnostics('sheet-ready', {
    width: dim.width,
    height: dim.height,
    scrollWidth: dim.scrollWidth,
    scrollHeight: dim.scrollHeight,
  } as ReportImageCaptureDiagnostics & { scrollWidth?: number; scrollHeight?: number })

  const primary = computeSafePixelRatio(dim.width, dim.height, 2)
  let lastError: unknown = null
  let lastDiag: Partial<ReportImageCaptureDiagnostics> = {
    width: dim.width,
    height: dim.height,
  }

  const attempts: CaptureAttemptOptions[] = [
    primary,
    { pixelRatio: 1, usedCompatMode: true, compatNote: '日报内容较长，已使用兼容清晰度导出' },
  ]

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]!
    try {
      const result = await captureOnce(node, dim, attempt)
      logReportCaptureDiagnostics('capture-success', result.diagnostics)
      return result
    } catch (err) {
      lastError = err
      if (err instanceof ReportImageCaptureError) {
        lastDiag = { ...lastDiag, ...err.diagnostics }
        logReportCaptureDiagnostics('capture-attempt-failed', {
          ...err.diagnostics,
          errorName: err.diagnostics.errorName ?? err.name,
          errorMessage: err.diagnostics.errorMessage ?? err.message,
        })
      } else if (err instanceof Error) {
        logReportCaptureDiagnostics('capture-attempt-failed', {
          ...lastDiag,
          errorName: err.name,
          errorMessage: err.message,
        })
      }
      if (i === attempts.length - 1) break
      await waitForNextPaint()
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
  }

  throw new ReportImageCaptureError(formatReportCaptureError(lastError, lastDiag), {
    ...lastDiag,
    errorName: lastError instanceof Error ? lastError.name : 'UnknownError',
    errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
  })
}
