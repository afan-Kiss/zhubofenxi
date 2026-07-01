export interface AnchorAttendanceStatusView {
  hasSchedule?: boolean
  hasManualSchedule?: boolean
  hasActualStartTime?: boolean
  hasActualEndTime?: boolean
  isLate?: boolean
  lateMinutes?: number | null
  isEarlyLeave?: boolean
  earlyLeaveMinutes?: number | null
  scheduledPeriodText?: string | null
  scheduledStartAt?: string | null
  scheduledEndAt?: string | null
  actualStartAt?: string | null
  actualStartText?: string | null
  actualEndAt?: string | null
  actualEndText?: string | null
  sessionLabel?: string
  shopName?: string
  displaySessionLabel?: string
  label?: string
  reason?: string
  attendanceLabel?: string
  attendanceReason?: string
}

/** @deprecated 使用 AnchorAttendanceStatusView */
export type AnchorLateStatusView = AnchorAttendanceStatusView

export function readAttendanceStatus(
  source: AnchorAttendanceStatusView | Record<string, unknown>,
): AnchorAttendanceStatusView {
  const row = source as AnchorAttendanceStatusView
  const hasSchedule = Boolean(row.hasSchedule ?? row.hasManualSchedule)
  return {
    hasSchedule,
    hasManualSchedule: hasSchedule,
    hasActualStartTime: Boolean(row.hasActualStartTime),
    hasActualEndTime: Boolean(row.hasActualEndTime),
    isLate: Boolean(row.isLate),
    lateMinutes: row.lateMinutes ?? null,
    isEarlyLeave: Boolean(row.isEarlyLeave),
    earlyLeaveMinutes: row.earlyLeaveMinutes ?? null,
    scheduledPeriodText: row.scheduledPeriodText ?? null,
    scheduledStartAt: row.scheduledStartAt ?? null,
    scheduledEndAt: row.scheduledEndAt ?? null,
    actualStartAt: row.actualStartAt ?? null,
    actualStartText: row.actualStartText ?? null,
    actualEndAt: row.actualEndAt ?? null,
    actualEndText: row.actualEndText ?? null,
    sessionLabel: row.sessionLabel ?? row.displaySessionLabel ?? '',
    shopName: row.shopName ?? '',
    displaySessionLabel: row.displaySessionLabel ?? row.sessionLabel ?? '',
    label: row.label ?? row.attendanceLabel ?? '',
    reason: row.reason ?? row.attendanceReason ?? '',
    attendanceLabel: row.attendanceLabel ?? row.label ?? '',
    attendanceReason: row.attendanceReason ?? row.reason ?? '',
  }
}

/** @deprecated */
export const readLateStatus = readAttendanceStatus

export function formatAttendanceTimingLine(row: AnchorAttendanceStatusView): string | null {
  if (row.attendanceReason) return row.attendanceReason
  if (row.reason) return row.reason

  const schedule = row.scheduledPeriodText?.replace('~', '-') ?? null
  const actualStart = row.actualStartText ?? null
  const actualEnd = row.actualEndText ?? null
  if (schedule && actualStart && actualEnd) {
    return `排班 ${schedule}｜实际 ${actualStart}-${actualEnd}`
  }
  if (schedule && actualStart) {
    return `排班 ${schedule}｜实际 ${actualStart}`
  }

  if (row.isLate || row.isEarlyLeave) {
    return row.attendanceLabel || row.label || null
  }
  if (row.hasSchedule && row.hasActualStartTime && row.hasActualEndTime) {
    return row.attendanceLabel || '准时开播，正常下播'
  }
  if (!row.hasSchedule && row.hasActualStartTime) return '未排班'
  if (row.hasSchedule && !row.hasActualStartTime) return '未读取开播时间'
  if (row.hasSchedule && row.hasActualStartTime && !row.hasActualEndTime) {
    return '未读取下播时间'
  }
  if (row.label) return row.label
  return null
}

/** @deprecated */
export const formatLateTimingLine = formatAttendanceTimingLine

export function attendanceCardBorderClass(row: Pick<AnchorAttendanceStatusView, 'isLate' | 'isEarlyLeave'>): string {
  if (row.isLate && row.isEarlyLeave) {
    return 'border-orange-300 bg-gradient-to-br from-red-50/80 to-orange-50/70'
  }
  if (row.isLate) {
    return 'border-red-300 bg-gradient-to-br from-red-50/90 to-orange-50/50'
  }
  if (row.isEarlyLeave) {
    return 'border-amber-300 bg-gradient-to-br from-amber-50/90 to-orange-50/40'
  }
  return 'border-rose-100 bg-white'
}

/** @deprecated */
export function lateCardBorderClass(isLate?: boolean, isEarlyLeave?: boolean): string {
  return attendanceCardBorderClass({ isLate, isEarlyLeave })
}

export function attendanceTextClass(row: Pick<AnchorAttendanceStatusView, 'isLate' | 'isEarlyLeave'>): string {
  if (row.isLate || row.isEarlyLeave) return 'font-medium text-red-600'
  return 'text-slate-500'
}

/** @deprecated */
export const lateTextClass = (isLate?: boolean) =>
  attendanceTextClass({ isLate, isEarlyLeave: false })

export function isMultiDayLateRange(startDate: string, endDate: string): boolean {
  return startDate.trim() !== endDate.trim()
}
