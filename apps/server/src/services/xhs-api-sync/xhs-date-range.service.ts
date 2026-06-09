import {
  endOfDay,
  endOfMonth,
  formatDateKey,
  resolveDateRange,
  startOfDay,
  startOfMonth,
  type DateRangePreset,
  type DateRangeResolved,
} from '../../utils/date-range'

export type XhsDateRangePreset = DateRangePreset | 'last7days' | 'last15days'

export interface XhsDateRangeContext extends DateRangeResolved {
  startDateTimeText: string
  endDateTimeText: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateTimeText(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function normalizePreset(preset: string): DateRangePreset {
  if (preset === 'last7days') return 'last7'
  if (preset === 'last15days') return 'last15'
  return preset as DateRangePreset
}

export function resolveXhsDateRange(
  preset: string,
  customStart?: string,
  customEnd?: string,
): XhsDateRangeContext {
  const now = new Date()
  let start: Date
  let end: Date

  const p = normalizePreset(preset)

  switch (p) {
    case 'today': {
      start = startOfDay(now)
      end = now
      break
    }
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      start = startOfDay(y)
      end = endOfDay(y)
      break
    }
    case 'last7': {
      const s = new Date(now)
      s.setDate(s.getDate() - 6)
      start = startOfDay(s)
      end = now
      break
    }
    case 'last15': {
      const s = new Date(now)
      s.setDate(s.getDate() - 14)
      start = startOfDay(s)
      end = now
      break
    }
    case 'thisMonth': {
      start = startOfMonth(now.getFullYear(), now.getMonth())
      end = now
      break
    }
    case 'lastMonth': {
      const m = now.getMonth() - 1
      const y = m < 0 ? now.getFullYear() - 1 : now.getFullYear()
      const monthIndex = m < 0 ? 11 : m
      start = startOfMonth(y, monthIndex)
      end = endOfDay(new Date(endOfMonth(y, monthIndex)))
      break
    }
    default: {
      const base = resolveDateRange('custom', customStart, customEnd)
      return {
        ...base,
        startDateTimeText: `${base.startDate} 00:00:00`,
        endDateTimeText: `${base.endDate} 23:59:59`,
      }
    }
  }

  const startDate = formatDateKey(start)
  const endDate = formatDateKey(end)

  return {
    startDate,
    endDate,
    startTimeMs: start.getTime(),
    endTimeMs: end.getTime(),
    startDateTimeText: formatDateTimeText(start),
    endDateTimeText: formatDateTimeText(end),
  }
}
