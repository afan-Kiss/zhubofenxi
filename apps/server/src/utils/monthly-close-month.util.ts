/**
 * 每月 15 号复盘「上个月完整自然月」的日期规则（Asia/Shanghai）
 *
 * 例：2026-07-15 → 核对 2026-06-01 ~ 2026-06-30
 */
import {
  endOfMonthKeyShanghai,
  formatDateKeyShanghai,
  shanghaiDateParts,
  startOfMonthKeyShanghai,
} from './business-timezone'
import { resolveMonthlyReportRange } from '../services/monthly-operations-report.service'

const MONTH_KEY_RE = /^\d{4}-\d{2}$/

export interface MonthlyCloseMonthResolved {
  month: string
  startDate: string
  endDate: string
  /** 是否为完整自然月（1 日 ~ 月末） */
  isCompleteNaturalMonth: boolean
  executionDateKey: string
  /** 是否适合做结账判断（完整月且非未来月） */
  suitableForCloseCheck: boolean
  closeCheckNote: string
}

/** 上海日历下的上一个完整自然月 YYYY-MM */
export function resolvePreviousCalendarMonthKey(now: Date = new Date()): string {
  const { year, month } = shanghaiDateParts(now)
  if (month === 1) return `${year - 1}-12`
  return `${year}-${String(month - 1).padStart(2, '0')}`
}

export function resolveMonthlyCloseMonth(params: {
  month?: string
  autoPrevMonth?: boolean
  now?: Date
}): MonthlyCloseMonthResolved {
  const now = params.now ?? new Date()
  const executionDateKey = formatDateKeyShanghai(now)
  const { year, month: currentMonth, day } = shanghaiDateParts(now)

  let monthKey: string
  if (params.month?.trim()) {
    monthKey = params.month.trim()
    if (!MONTH_KEY_RE.test(monthKey)) {
      throw new Error('month 格式应为 YYYY-MM')
    }
  } else if (params.autoPrevMonth) {
    monthKey = resolvePreviousCalendarMonthKey(now)
  } else {
    throw new Error('请提供 --month=YYYY-MM 或 --auto-prev-month')
  }

  const { startDate, endDate } = resolveMonthlyReportRange({ month: monthKey })
  const isCompleteNaturalMonth =
    startDate === startOfMonthKeyShanghai(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7))) &&
    endDate === endOfMonthKeyShanghai(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)))

  const currentMonthKey = `${year}-${String(currentMonth).padStart(2, '0')}`
  const isFutureMonth = monthKey > currentMonthKey
  const isCurrentIncompleteMonth = monthKey === currentMonthKey

  const notes: string[] = []
  if (isFutureMonth) {
    notes.push('所选月份在未来，不能用于结账核对')
  }
  if (isCurrentIncompleteMonth) {
    notes.push('所选月份尚未结束，不能当作完整月结账')
  }
  if (params.autoPrevMonth && day < 15) {
    notes.push(`今天是 ${executionDateKey}，未到 15 号；可先预看，建议 15 号后再正式核对`)
  }
  if (params.autoPrevMonth && day >= 15) {
    notes.push(`今天是 ${executionDateKey}，适合核对上个月 ${monthKey} 完整数据`)
  }

  const suitableForCloseCheck =
    isCompleteNaturalMonth && !isFutureMonth && !isCurrentIncompleteMonth

  return {
    month: monthKey,
    startDate,
    endDate,
    isCompleteNaturalMonth,
    executionDateKey,
    suitableForCloseCheck,
    closeCheckNote: notes.join('；') || '日期范围正常',
  }
}
