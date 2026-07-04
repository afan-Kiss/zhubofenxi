import React from 'react'
import type { LucideIcon } from 'lucide-react'

export type BoardSummaryMetricTone =
  | 'blue'
  | 'violet'
  | 'green'
  | 'teal'
  | 'rose'
  | 'orange'
  | 'amber'

const TONE_STYLES: Record<
  BoardSummaryMetricTone,
  { bar: string; iconWrap: string; icon: string; hoverBorder: string }
> = {
  blue: {
    bar: 'from-blue-500 to-sky-400',
    iconWrap: 'bg-blue-50 text-blue-600',
    icon: 'text-blue-600',
    hoverBorder: 'hover:border-blue-200',
  },
  violet: {
    bar: 'from-violet-600 to-indigo-400',
    iconWrap: 'bg-violet-50 text-violet-600',
    icon: 'text-violet-600',
    hoverBorder: 'hover:border-violet-200',
  },
  green: {
    bar: 'from-emerald-600 to-green-400',
    iconWrap: 'bg-emerald-50 text-emerald-600',
    icon: 'text-emerald-600',
    hoverBorder: 'hover:border-emerald-200',
  },
  teal: {
    bar: 'from-teal-600 to-cyan-400',
    iconWrap: 'bg-teal-50 text-teal-600',
    icon: 'text-teal-600',
    hoverBorder: 'hover:border-teal-200',
  },
  rose: {
    bar: 'from-rose-600 to-orange-400',
    iconWrap: 'bg-rose-50 text-rose-600',
    icon: 'text-rose-600',
    hoverBorder: 'hover:border-rose-200',
  },
  orange: {
    bar: 'from-orange-500 to-amber-400',
    iconWrap: 'bg-orange-50 text-orange-600',
    icon: 'text-orange-600',
    hoverBorder: 'hover:border-orange-200',
  },
  amber: {
    bar: 'from-amber-500 to-yellow-400',
    iconWrap: 'bg-amber-50 text-amber-600',
    icon: 'text-amber-600',
    hoverBorder: 'hover:border-amber-200',
  },
}

interface Props {
  label: React.ReactNode
  value: React.ReactNode
  helper?: string
  hint?: string
  tone: BoardSummaryMetricTone
  icon: LucideIcon
  onClick?: () => void
}

/** 经营看板指标卡：统一高度、色条分组、可下钻 */
export const BoardSummaryMetricCard: React.FC<Props> = ({
  label,
  value,
  helper,
  hint,
  tone,
  icon: Icon,
  onClick,
}) => {
  const styles = TONE_STYLES[tone]
  const clickable = Boolean(onClick)

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick?.()
            }
          : undefined
      }
      className={`group relative flex h-full min-h-[132px] min-w-0 flex-col overflow-visible rounded-2xl border border-slate-100/80 bg-white/95 px-4 py-3.5 shadow-sm transition duration-200 ${styles.hoverBorder} ${
        clickable
          ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300'
          : ''
      }`}
    >
      <span
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b ${styles.bar}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="min-w-0 text-xs font-medium leading-snug text-slate-600">{label}</div>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${styles.iconWrap}`}
          aria-hidden
        >
          <Icon className={`h-4 w-4 ${styles.icon}`} strokeWidth={2} />
        </span>
      </div>
      <div className="mt-auto pl-2 pt-2">
        <div className="whitespace-nowrap text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.65rem]">
          {value}
        </div>
        {helper ? (
          <p className="mt-1 line-clamp-1 text-[11px] leading-tight text-slate-400">{helper}</p>
        ) : null}
        {hint && clickable ? (
          <p className="mt-0.5 text-[10px] text-rose-500 opacity-0 transition group-hover:opacity-100">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}
