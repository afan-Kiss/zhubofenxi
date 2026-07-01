export interface AnchorLateStatusView {
  hasSchedule?: boolean
  hasManualSchedule?: boolean
  hasActualStartTime?: boolean
  isLate?: boolean
  lateMinutes?: number | null
  scheduledPeriodText?: string | null
  scheduledStartAt?: string | null
  actualStartAt?: string | null
  actualStartText?: string | null
  label?: string
  reason?: string
}

export function readLateStatus(source: AnchorLateStatusView | Record<string, unknown>): AnchorLateStatusView {
  const row = source as AnchorLateStatusView
  const hasSchedule = Boolean(row.hasSchedule ?? row.hasManualSchedule)
  return {
    hasSchedule,
    hasManualSchedule: hasSchedule,
    hasActualStartTime: Boolean(row.hasActualStartTime),
    isLate: Boolean(row.isLate),
    lateMinutes: row.lateMinutes ?? null,
    scheduledPeriodText: row.scheduledPeriodText ?? null,
    scheduledStartAt: row.scheduledStartAt ?? null,
    actualStartAt: row.actualStartAt ?? null,
    actualStartText: row.actualStartText ?? null,
    label: row.label ?? '',
    reason: row.reason ?? '',
  }
}

export function formatLateTimingLine(row: AnchorLateStatusView): string | null {
  if (row.isLate) {
    if (row.reason) return row.reason
    if (row.lateMinutes != null) return `迟播 ${row.lateMinutes} 分钟`
    return row.label || '迟播'
  }
  if (row.hasSchedule && row.hasActualStartTime) {
    return row.reason || row.label || null
  }
  if (!row.hasSchedule && row.hasActualStartTime) return '未排班'
  if (row.hasSchedule && !row.hasActualStartTime) return '未读取开播时间'
  if (row.label) return row.label
  return null
}

export function lateCardBorderClass(isLate?: boolean): string {
  return isLate
    ? 'border-red-300 bg-gradient-to-br from-red-50/90 to-orange-50/50'
    : 'border-rose-100 bg-white'
}

export function lateTextClass(isLate?: boolean): string {
  return isLate ? 'font-medium text-red-600' : 'text-slate-500'
}
