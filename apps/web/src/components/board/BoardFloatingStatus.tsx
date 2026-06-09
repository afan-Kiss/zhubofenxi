import React from 'react'
import { Loader2 } from 'lucide-react'

export type BoardFloatingStatusVariant = 'loading' | 'warning' | 'error'

interface Props {
  visible: boolean
  text: string
  variant?: BoardFloatingStatusVariant
}

const VARIANT_CLASS: Record<BoardFloatingStatusVariant, string> = {
  loading: 'border-rose-100 bg-rose-50/95 text-rose-800',
  warning: 'border-amber-200 bg-amber-50/95 text-amber-900',
  error: 'border-red-200 bg-red-50/95 text-red-800',
}

/** 不参与文档流的看板状态浮层（opacity + transform 显隐） */
export const BoardFloatingStatus: React.FC<Props> = ({
  visible,
  text,
  variant = 'loading',
}) => {
  if (!text) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      className={`board-floating-status ${visible ? 'is-visible' : ''} ${VARIANT_CLASS[variant]}`.trim()}
    >
      {variant === 'loading' ? (
        <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />
      ) : null}
      <span>{text}</span>
    </div>
  )
}
