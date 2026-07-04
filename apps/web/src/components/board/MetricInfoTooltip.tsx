import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'

interface Props {
  text: string
  className?: string
}

function stopBubble(e: React.SyntheticEvent) {
  e.stopPropagation()
}

export const MetricInfoTooltip: React.FC<Props> = ({ text, className = '' }) => {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})
  const tooltipId = useId()
  const visible = open || hover

  const close = useCallback(() => {
    setOpen(false)
    setHover(false)
  }, [])

  const updatePopoverPosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const width = Math.min(256, window.innerWidth - 32)
    const left = Math.min(
      Math.max(16, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 16,
    )
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const placeBelow = spaceAbove < 120 && spaceBelow > spaceAbove

    setPopoverStyle({
      position: 'fixed',
      left,
      width,
      zIndex: 9999,
      ...(placeBelow
        ? { top: rect.bottom + 8 }
        : { bottom: window.innerHeight - rect.top + 8 }),
    })
  }, [])

  useEffect(() => {
    if (!visible) return
    updatePopoverPosition()
    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, true)
    return () => {
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
    }
  }, [visible, updatePopoverPosition])

  useEffect(() => {
    if (!open) return
    let cleanup: (() => void) | undefined
    const timer = window.setTimeout(() => {
      const onDoc = (e: MouseEvent | TouchEvent) => {
        const target = e.target as Node
        if (rootRef.current?.contains(target)) return
        close()
      }
      document.addEventListener('click', onDoc)
      document.addEventListener('touchstart', onDoc)
      cleanup = () => {
        document.removeEventListener('click', onDoc)
        document.removeEventListener('touchstart', onDoc)
      }
    }, 0)
    return () => {
      window.clearTimeout(timer)
      cleanup?.()
    }
  }, [open, close])

  if (!text.trim()) return null

  const popover =
    visible && typeof document !== 'undefined' ? (
      createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="rounded-xl border border-rose-100/80 bg-white px-2.5 py-2 text-[10px] leading-relaxed text-slate-600 shadow-[0_8px_24px_rgba(244,63,94,0.12)]"
          style={popoverStyle}
        >
          {text}
        </span>,
        document.body,
      )
    ) : null

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex shrink-0 align-middle ${className}`}
      onClick={stopBubble}
      onKeyDown={stopBubble}
      onPointerDown={stopBubble}
      onTouchStart={stopBubble}
    >
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex rounded-full p-0.5 text-rose-300 transition hover:bg-rose-50 hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
        aria-label="口径说明"
        aria-expanded={visible}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => {
          stopBubble(e)
          setOpen((v) => !v)
        }}
      >
        <CircleHelp size={13} strokeWidth={2} />
      </button>
      {popover}
    </span>
  )
}
