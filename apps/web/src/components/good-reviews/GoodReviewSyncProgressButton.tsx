import React from 'react'
import { Loader2 } from 'lucide-react'

interface Props {
  busy: boolean
  progress: number
  idleLabel: string
  busyLabel: string
  idleIcon: React.ReactNode
  busyIcon?: React.ReactNode
  variant?: 'primary' | 'secondary'
  testId?: string
  disabled?: boolean
  onClick: () => void
}

export const GoodReviewSyncProgressButton: React.FC<Props> = ({
  busy,
  progress,
  idleLabel,
  busyLabel,
  idleIcon,
  busyIcon,
  variant = 'primary',
  testId,
  disabled = false,
  onClick,
}) => {
  const fillWidth = busy ? Math.min(100, Math.max(0, progress)) : 0
  const isPrimary = variant === 'primary'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      data-testid={testId}
      className={`relative overflow-hidden rounded-full px-3 py-2 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${
        isPrimary
          ? 'bg-rose-500 text-white hover:bg-rose-600'
          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span
        aria-hidden
        data-testid={testId ? `${testId}-fill` : undefined}
        className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${
          isPrimary ? 'bg-rose-700/90' : 'bg-rose-100'
        }`}
        style={{ width: `${fillWidth}%` }}
      />
      <span className="relative z-[1] inline-flex items-center gap-1.5">
        {busy ? (busyIcon ?? <Loader2 size={14} className="animate-spin" />) : idleIcon}
        <span>{busy ? busyLabel : idleLabel}</span>
        {busy && fillWidth > 0 && fillWidth < 100 ? (
          <span className={`text-[11px] ${isPrimary ? 'text-white/90' : 'text-rose-600'}`}>
            {fillWidth}%
          </span>
        ) : null}
      </span>
    </button>
  )
}
