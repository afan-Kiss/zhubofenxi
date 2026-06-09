/** 日期范围：Asia/Shanghai 00:00:00 ~ 23:59:59.999 */

import {
  addDaysShanghai,
  endOfDayMsShanghai,
  endOfMonthKeyShanghai,
  formatDateKeyShanghai,
  shanghaiDateParts,
  startOfDayMsShanghai,
  startOfMonthKeyShanghai,
  thisWeekStartKeyShanghai,
} from './business-timezone'

export { BUSINESS_TIMEZONE } from './business-timezone'

export interface DateRangeResolved {
  startDate: string
  endDate: string
  startTimeMs: number
  endTimeMs: number
}

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'last7'
  | 'last15'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function formatDateKey(d: Date): string {
  return formatDateKeyShanghai(d)
}

/** @deprecated 使用 startOfDayMsShanghai */
export function startOfDay(date: Date): Date {
  const key = formatDateKeyShanghai(date)
  return new Date(startOfDayMsShanghai(key))
}

/** @deprecated 使用 endOfDayMsShanghai */
export function endOfDay(date: Date): Date {
  const key = formatDateKeyShanghai(date)
  return new Date(endOfDayMsShanghai(key))
}

export function startOfMonth(year: number, monthIndex: number): Date {
  const key = startOfMonthKeyShanghai(year, monthIndex + 1)
  return new Date(startOfDayMsShanghai(key))
}

export function endOfMonth(year: number, monthIndex: number): Date {
  const key = endOfMonthKeyShanghai(year, monthIndex + 1)
  return new Date(endOfDayMsShanghai(key))
}

export function resolveDateRange(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
): DateRangeResolved {
  const now = new Date()
  const todayKey = formatDateKeyShanghai(now)
  let startDate: string
  let endDate: string

  switch (preset) {
    case 'today': {
      startDate = todayKey
      endDate = todayKey
      break
    }
    case 'yesterday': {
      startDate = addDaysShanghai(todayKey, -1)
      endDate = startDate
      break
    }
    case 'thisWeek': {
      startDate = thisWeekStartKeyShanghai(now)
      endDate = todayKey
      break
    }
    case 'last7': {
      startDate = addDaysShanghai(todayKey, -6)
      endDate = todayKey
      break
    }
    case 'last15': {
      startDate = addDaysShanghai(todayKey, -14)
      endDate = todayKey
      break
    }
    case 'thisMonth': {
      const { year, month } = shanghaiDateParts(now)
      startDate = startOfMonthKeyShanghai(year, month)
      endDate = todayKey
      break
    }
    case 'lastMonth': {
      const { year, month } = shanghaiDateParts(now)
      const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
      startDate = startOfMonthKeyShanghai(prevMonth.y, prevMonth.m)
      endDate = endOfMonthKeyShanghai(prevMonth.y, prevMonth.m)
      break
    }
    case 'custom':
    default: {
      const sd = customStart?.trim()
      const ed = customEnd?.trim()
      if (!sd || !ed || !DATE_RE.test(sd) || !DATE_RE.test(ed)) {
        throw new Error('自定义日期范围无效，请使用 YYYY-MM-DD 格式')
      }
      startDate = sd
      endDate = ed
      if (endDate > todayKey) endDate = todayKey
      if (startDate > endDate) {
        throw new Error('开始日期不能晚于结束日期')
      }
      break
    }
  }

  return {
    startDate,
    endDate,
    startTimeMs: startOfDayMsShanghai(startDate),
    endTimeMs: endOfDayMsShanghai(endDate),
  }
}

/** 滚动 N 天（含今天），用于每日同步策略 */
export function resolveRollingDays(days: number, endDate?: Date): DateRangeResolved {
  const n = Math.max(1, Math.floor(days))
  const endKey = endDate ? formatDateKeyShanghai(endDate) : formatDateKeyShanghai(new Date())
  const startKey = addDaysShanghai(endKey, -(n - 1))
  return {
    startDate: startKey,
    endDate: endKey,
    startTimeMs: startOfDayMsShanghai(startKey),
    endTimeMs: endOfDayMsShanghai(endKey),
  }
}

/** 宽范围起始日，用于拉取全部未结算订单 */
export function resolveWidePendingRange(endDate?: Date): DateRangeResolved {
  return resolveRollingDays(365 * 3, endDate)
}

/** 默认：本月 */
export function defaultThisMonthRange(): DateRangeResolved {
  return resolveDateRange('thisMonth')
}
