import React, { useCallback, useEffect, useState } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  src: string | null
  alt?: string
  onClose: () => void
}

/** 日报发货照片 / 日报长图预览：滚轮缩放（与好评中心 GoodReviewImagePreview 一致） */
export const DailyReportImagePreview: React.FC<Props> = ({
  open,
  src,
  alt = '图片预览',
  onClose,
}) => {
  const [mounted, setMounted] = useState(false)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setScale(1)
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
    return undefined
  }, [open, src])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => Math.min(5, Math.max(0.25, Number((s + delta).toFixed(2)))))
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      zoomBy(e.deltaY < 0 ? 0.12 : -0.12)
    },
    [zoomBy],
  )

  if (!mounted || !open || !src) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/85"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-white">
        <span className="truncate text-sm text-white/80">滚轮缩放 · 右键可复制或保存</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-white/10"
            aria-label="缩小"
            onClick={() => zoomBy(-0.2)}
          >
            <ZoomOut size={18} />
          </button>
          <span className="min-w-[3rem] text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-white/10"
            aria-label="放大"
            onClick={() => zoomBy(0.2)}
          >
            <ZoomIn size={18} />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-white/10"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={onWheel}
        onClick={onClose}
        role="presentation"
      >
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div
            className="flex items-center justify-center"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="max-h-[calc(100vh-5rem)] max-w-[min(92vw,calc((100vh-5rem)*1.2))] select-none object-contain"
              style={{ cursor: scale > 1 ? 'zoom-out' : 'zoom-in' }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
