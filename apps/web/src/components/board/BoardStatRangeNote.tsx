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
  const meta =
    startDate && endDate ? formatBoardStatRangeLabel(startDate, endDate) : null

  if (!startDate || !endDate || !meta) return null

  const windowText = meta.windowText
  const mobileWindowText = windowText.replace(/ 00:00:00| 23:59:59/g, '')
  return (
    <div
      className={`flex gap-2.5 rounded-xl border border-sky-100/80 bg-gradient-to-r from-sky-50/70 to-white px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 shadow-sm ${className}`}
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100/80 text-sky-600">
        <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <div className="font-medium text-slate-700">
          <span className="sm:hidden">统计：{mobileWindowText}</span>
          <span className="hidden sm:inline">统计窗口：{windowText}</span>
        </div>
        <div className="mt-0.5 text-slate-500">
          <span className="sm:hidden">支付时间归属 · 与接口查询一致{meta.includesTodayRealtime ? ' · 含今日实时' : ''}</span>
          <span className="hidden sm:inline">
            {meta.payAmountNote} · {meta.masterOrderNote}
            {meta.includesTodayRealtime ? ' · 含当天实时订单' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
