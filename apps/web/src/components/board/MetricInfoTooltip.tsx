import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'

interface Props {
  text: string
  className?: string
}

export const MetricInfoTooltip: React.FC<Props> = ({ text, className = '' }) => {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const tooltipId = useId()
  const visible = open || hover

  const close = useCallback(() => {
    setOpen(false)
    setHover(false)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [open, close])

  if (!text.trim()) return null

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex shrink-0 align-middle ${className}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex rounded-full p-0.5 text-rose-300 transition hover:bg-rose-50 hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
        aria-label="口径说明"
        aria-expanded={visible}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp size={13} strokeWidth={2} />
      </button>
      {visible ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-rose-100/80 bg-white px-2.5 py-2 text-[10px] leading-relaxed text-slate-600 shadow-[0_8px_24px_rgba(244,63,94,0.12)]"
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}
