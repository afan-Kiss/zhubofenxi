import React from 'react'
import { CalendarRange } from 'lucide-react'
import { formatBoardStatRangeLabel } from '../../lib/board-stat-range-label'

interface Props {
  startDate: string
  endDate: string
  className?: string
}

export const BoardStatRangeNote: React.FC<Props> = ({
  startDate,
  endDate,
  className = '',
}) => {
  if (!startDate || !endDate) return null
  const meta = formatBoardStatRangeLabel(startDate, endDate)
  return (
    <div
      className={`flex gap-2.5 rounded-xl border border-sky-100/80 bg-gradient-to-r from-sky-50/70 to-white px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 shadow-sm ${className}`}
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100/80 text-sky-600">
        <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <div className="font-medium text-slate-700">统计窗口：{meta.windowText}</div>
        <div className="mt-0.5 text-slate-500">
          {meta.payAmountNote} · {meta.masterOrderNote}
          {meta.includesTodayRealtime ? ' · 含当天实时订单' : ''}
        </div>
      </div>
    </div>
  )
}
