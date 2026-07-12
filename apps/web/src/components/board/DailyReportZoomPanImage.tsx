import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'

interface Props {
  src: string
  alt?: string
  className?: string
  imageTestId?: string
}

export const DailyReportZoomPanImage: React.FC<Props> = ({
  src,
  alt = '主播日报',
  className = '',
  imageTestId,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  )

  useEffect(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [src])

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => Math.min(5, Math.max(0.25, Number((s + delta).toFixed(2)))))
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      zoomBy(e.deltaY < 0 ? 0.12 : -0.12)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    setDragging(true)
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const drag = dragStateRef.current
    if (!drag) return
    setPan({
      x: drag.panX + (e.clientX - drag.startX),
      y: drag.panY + (e.clientY - drag.startY),
    })
  }

  const endDrag = () => {
    dragStateRef.current = null
    setDragging(false)
  }

  return (
    <div className={`flex min-h-0 flex-col ${className}`.trim()}>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>滚轮缩放 · 按住左键拖动查看 · 右键可复制</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="缩小"
            onClick={() => zoomBy(-0.2)}
          >
            <ZoomOut size={16} />
          </button>
          <span className="min-w-[3rem] text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="放大"
            onClick={() => zoomBy(0.2)}
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
            onClick={() => {
              setScale(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            重置
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`relative min-h-[min(52dvh,520px)] flex-1 overflow-hidden overscroll-contain rounded-xl border border-slate-100 bg-slate-50 touch-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div className="absolute inset-0 flex items-start justify-center p-2">
          <img
            src={src}
            alt={alt}
            data-testid={imageTestId}
            draggable={false}
            className="w-full max-w-full select-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: 'top center',
            }}
          />
        </div>
      </div>
    </div>
  )
}
