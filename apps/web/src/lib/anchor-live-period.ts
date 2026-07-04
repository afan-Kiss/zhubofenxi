export interface AnchorLivePeriodView {
  hasSchedule?: boolean
  hasActualStartTime?: boolean
  hasActualEndTime?: boolean
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
  scheduleTimeRange?: string | null
  liveTimeRange?: string | null
  livePeriodText?: string | null
}

export function readLivePeriod(
  source: AnchorLivePeriodView | Record<string, unknown>,
): AnchorLivePeriodView {
  const row = source as AnchorLivePeriodView
  return {
    hasSchedule: Boolean(row.hasSchedule),
    hasActualStartTime: Boolean(row.hasActualStartTime),
    hasActualEndTime: Boolean(row.hasActualEndTime),
    scheduledPeriodText: row.scheduledPeriodText ?? row.scheduleTimeRange ?? null,
    scheduledStartAt: row.scheduledStartAt ?? null,
    scheduledEndAt: row.scheduledEndAt ?? null,
    actualStartAt: row.actualStartAt ?? null,
    actualStartText: row.actualStartText ?? null,
    actualEndAt: row.actualEndAt ?? null,
    actualEndText: row.actualEndText ?? null,
    sessionLabel: row.sessionLabel ?? row.displaySessionLabel ?? '',
    shopName: row.shopName ?? '',
    displaySessionLabel: row.displaySessionLabel ?? row.sessionLabel ?? '',
    scheduleTimeRange: row.scheduleTimeRange ?? row.scheduledPeriodText ?? null,
    liveTimeRange: row.liveTimeRange ?? null,
    livePeriodText: row.livePeriodText ?? null,
  }
}

export function formatLivePeriodTimingLine(row: AnchorLivePeriodView): string | null {
  const schedule = (row.scheduledPeriodText ?? row.scheduleTimeRange)?.replace(/~/g, '–') ?? null
  const actualStart = row.actualStartText ?? null
  const actualEnd = row.actualEndText ?? null
  if (schedule && actualStart && actualEnd) {
    return `排班 ${schedule} · 实际 ${actualStart}–${actualEnd}`
  }
  if (schedule && actualStart) {
    return `排班 ${schedule} · 实际 ${actualStart}`
  }
  if (!row.hasSchedule && row.hasActualStartTime) return '未排班'
  if (row.hasSchedule && !row.hasActualStartTime) return '未读取开播时间'
  if (row.hasSchedule && row.hasActualStartTime && !row.hasActualEndTime) {
    return '未读取下播时间'
  }
  return null
}

export function isMultiDayRange(startDate: string, endDate: string): boolean {
  return startDate.trim() !== endDate.trim()
}
