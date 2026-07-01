import React from 'react'
import {
  formatAttendanceTimingLine,
  readAttendanceStatus,
  type AnchorAttendanceStatusView,
} from '../../lib/anchor-late-status'

interface Props {
  row: AnchorAttendanceStatusView | Record<string, unknown>
  className?: string
}

export const AnchorAttendanceStatusBadge: React.FC<Props> = ({ row, className = '' }) => {
  const status = readAttendanceStatus(row)
  const badges: React.ReactNode[] = []

  if (status.isLate) {
    badges.push(
      <span
        key="late"
        className={`rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 ${className}`}
      >
        {status.lateMinutes != null ? `迟播 ${status.lateMinutes} 分钟` : '迟播'}
      </span>,
    )
  }
  if (status.isEarlyLeave) {
    badges.push(
      <span
        key="early"
        className={`rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800 ${className}`}
      >
        {status.earlyLeaveMinutes != null ? `早退 ${status.earlyLeaveMinutes} 分钟` : '早退'}
      </span>,
    )
  }
  if (badges.length > 0) {
    return <span className="flex flex-wrap justify-end gap-1">{badges}</span>
  }

  if (!status.hasSchedule && status.hasActualStartTime) {
    return (
      <span className={`rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 ${className}`}>
        未排班
      </span>
    )
  }
  if (status.hasSchedule && !status.hasActualStartTime) {
    return (
      <span className={`rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ${className}`}>
        未读取开播时间
      </span>
    )
  }
  if (status.hasSchedule && status.hasActualStartTime && !status.hasActualEndTime) {
    return (
      <span className={`rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ${className}`}>
        未读取下播时间
      </span>
    )
  }
  return null
}

/** @deprecated 使用 AnchorAttendanceStatusBadge */
export const AnchorLateStatusBadge = AnchorAttendanceStatusBadge

interface LineProps {
  row: AnchorAttendanceStatusView | Record<string, unknown>
  fallback?: string
  className?: string
}

export const AnchorAttendanceTimingLine: React.FC<LineProps> = ({ row, fallback, className = '' }) => {
  const status = readAttendanceStatus(row)
  const text = formatAttendanceTimingLine(status) ?? fallback
  if (!text) return null
  return (
    <p
      className={`${
        status.isLate || status.isEarlyLeave ? 'font-medium text-red-600' : 'text-slate-500'
      } ${className}`}
    >
      {text}
    </p>
  )
}

/** @deprecated */
export const AnchorLateTimingLine = AnchorAttendanceTimingLine
