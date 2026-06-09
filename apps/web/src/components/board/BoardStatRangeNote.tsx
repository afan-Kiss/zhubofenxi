import React from 'react'
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
      className={`rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] leading-relaxed text-slate-600 ${className}`}
    >
      <div className="font-medium text-slate-700">统计窗口：{meta.windowText}</div>
      <div className="mt-0.5 text-slate-500">
        {meta.payAmountNote} · {meta.masterOrderNote}
        {meta.includesTodayRealtime ? ' · 含当天实时订单' : ''}
      </div>
    </div>
  )
}
