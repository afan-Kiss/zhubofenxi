import {
  addDaysShanghai,
  endOfMonthKeyShanghai,
  formatDateKeyShanghai,
  shanghaiDateParts,
  startOfMonthKeyShanghai,
  thisWeekStartKeyShanghai,
} from './business-timezone'

export type BoardRangePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom'

export const BOARD_RANGE_PRESETS: { key: BoardRangePreset; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'thisWeek', label: '本周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'custom', label: '自定义' },
]

/** 所有 preset 均解析为具体 startDate / endDate（Asia/Shanghai） */
/** 与后端 buildBusinessRangeKey 一致 */
export function buildBoardRangeKey(
  preset: string,
  startDate: string,
  endDate: string,
): string {
  return `${preset}|${startDate}|${endDate}`
}

export function resolveBoardRangeDates(
  preset: BoardRangePreset,
  customStart: string,
  customEnd: string,
): { startDate: string; endDate: string } {
  const now = new Date()
  const todayKey = formatDateKeyShanghai(now)

  switch (preset) {
    case 'today':
      return { startDate: todayKey, endDate: todayKey }
    case 'yesterday': {
      const y = addDaysShanghai(todayKey, -1)
      return { startDate: y, endDate: y }
    }
    case 'thisWeek':
      return { startDate: thisWeekStartKeyShanghai(now), endDate: todayKey }
    case 'thisMonth': {
      const { year, month } = shanghaiDateParts(now)
      return { startDate: startOfMonthKeyShanghai(year, month), endDate: todayKey }
    }
    case 'lastMonth': {
      const { year, month } = shanghaiDateParts(now)
      const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
      return {
        startDate: startOfMonthKeyShanghai(prev.y, prev.m),
        endDate: endOfMonthKeyShanghai(prev.y, prev.m),
      }
    }
    case 'custom': {
      let end = customEnd
      if (end && end > todayKey) end = todayKey
      return { startDate: customStart, endDate: end }
    }
    default:
      return { startDate: '', endDate: '' }
  }
}

export function buildBoardRangeQuery(
  preset: BoardRangePreset,
  start?: string,
  end?: string,
): string {
  const dates = resolveBoardRangeDates(preset, start ?? '', end ?? '')
  const qs = new URLSearchParams()
  qs.set('preset', preset)
  if (dates.startDate) qs.set('startDate', dates.startDate)
  if (dates.endDate) qs.set('endDate', dates.endDate)
  return qs.toString()
}
