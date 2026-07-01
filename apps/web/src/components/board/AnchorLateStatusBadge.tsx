import React from 'react'
import { formatLateTimingLine, readLateStatus, type AnchorLateStatusView } from '../../lib/anchor-late-status'

interface Props {
  row: AnchorLateStatusView | Record<string, unknown>
  className?: string
}

export const AnchorLateStatusBadge: React.FC<Props> = ({ row, className = '' }) => {
  const late = readLateStatus(row)
  if (late.isLate) {
    return (
      <span
        className={`rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 ${className}`}
      >
        {late.label || `迟播 ${late.lateMinutes ?? ''} 分钟`}
      </span>
    )
  }
  if (!late.hasSchedule && late.hasActualStartTime) {
    return (
      <span className={`rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 ${className}`}>
        未排班
      </span>
    )
  }
  if (late.hasSchedule && !late.hasActualStartTime) {
    return (
      <span className={`rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ${className}`}>
        未读取开播时间
      </span>
    )
  }
  return null
}

interface LineProps {
  row: AnchorLateStatusView | Record<string, unknown>
  fallback?: string
  className?: string
}

export const AnchorLateTimingLine: React.FC<LineProps> = ({ row, fallback, className = '' }) => {
  const late = readLateStatus(row)
  const text = formatLateTimingLine(late) ?? fallback
  if (!text) return null
  return <p className={`${late.isLate ? 'font-medium text-red-600' : 'text-slate-500'} ${className}`}>{text}</p>
}
