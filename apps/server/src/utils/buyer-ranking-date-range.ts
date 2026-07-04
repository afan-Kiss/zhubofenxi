/** 买家排行专用日期范围（与看板 preset 独立，统一 Asia/Shanghai） */

import {
  addDaysShanghai,
  endOfDayMsShanghai,
  formatDateKeyShanghai,
  startOfDayMsShanghai,
  thisWeekStartKeyShanghai,
} from './business-timezone'

export type BuyerRankingPreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'recent7'
  | 'recent15'
  | 'recent30'
  | 'recent90'
  | 'thisYear'
  | 'all'
  | 'custom'

export interface BuyerRankingDateRange {
  preset: BuyerRankingPreset
  startDate: string
  endDate: string
  startTimeMs: number
  endTimeMs: number
  isAll: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function startOfMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function endOfMonthKey(year: number, month: number): string {
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  return addDaysShanghai(startOfMonthKey(nextMonth.y, nextMonth.m), -1)
}

function shanghaiMonthParts(now: Date): { year: number; month: number; day: number } {
  const todayKey = formatDateKeyShanghai(now)
  const [y, m, d] = todayKey.split('-').map(Number)
  return { year: y!, month: m!, day: d! }
}

/** 上周一（Asia/Shanghai） */
export function lastWeekStartKeyShanghai(now: Date = new Date()): string {
  const thisWeekStart = thisWeekStartKeyShanghai(now)
  return addDaysShanghai(thisWeekStart, -7)
}

/** 上周日（Asia/Shanghai） */
export function lastWeekEndKeyShanghai(now: Date = new Date()): string {
  const thisWeekStart = thisWeekStartKeyShanghai(now)
  return addDaysShanghai(thisWeekStart, -1)
}

export function resolveBuyerRankingDateRange(
  presetRaw: string,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date(),
): BuyerRankingDateRange {
  const preset = presetRaw as BuyerRankingPreset
  const todayKey = formatDateKeyShanghai(now)

  if (preset === 'all') {
    return {
      preset: 'all',
      startDate: '—',
      endDate: '—',
      startTimeMs: 0,
      endTimeMs: Number.MAX_SAFE_INTEGER,
      isAll: true,
    }
  }

  let startDate: string
  let endDate: string

  switch (preset) {
    case 'today':
      startDate = todayKey
      endDate = todayKey
      break
    case 'yesterday':
      startDate = addDaysShanghai(todayKey, -1)
      endDate = startDate
      break
    case 'thisWeek':
      startDate = thisWeekStartKeyShanghai(now)
      endDate = todayKey
      break
    case 'lastWeek':
      startDate = lastWeekStartKeyShanghai(now)
      endDate = lastWeekEndKeyShanghai(now)
      break
    case 'thisMonth': {
      const { year, month } = shanghaiMonthParts(now)
      startDate = startOfMonthKey(year, month)
      endDate = todayKey
      break
    }
    case 'lastMonth': {
      const { year, month } = shanghaiMonthParts(now)
      const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
      startDate = startOfMonthKey(prev.y, prev.m)
      endDate = endOfMonthKey(prev.y, prev.m)
      break
    }
    case 'recent7':
      startDate = addDaysShanghai(todayKey, -6)
      endDate = todayKey
      break
    case 'recent15':
      startDate = addDaysShanghai(todayKey, -14)
      endDate = todayKey
      break
    case 'recent30':
      startDate = addDaysShanghai(todayKey, -29)
      endDate = todayKey
      break
    case 'recent90':
      startDate = addDaysShanghai(todayKey, -89)
      endDate = todayKey
      break
    case 'thisYear': {
      const { year } = shanghaiMonthParts(now)
      startDate = `${year}-01-01`
      endDate = todayKey
      break
    }
    case 'custom':
    default: {
      const sd = customStart?.trim()
      const ed = customEnd?.trim()
      if (!sd || !ed || !DATE_RE.test(sd) || !DATE_RE.test(ed)) {
        throw new Error('自定义日期范围无效，请使用 YYYY-MM-DD 格式')
      }
      if (sd > ed) {
        throw new Error('开始日期不能晚于结束日期')
      }
      startDate = sd
      endDate = ed
      break
    }
  }

  const known: BuyerRankingPreset[] = [
    'today',
    'yesterday',
    'thisWeek',
    'lastWeek',
    'thisMonth',
    'lastMonth',
    'recent7',
    'recent15',
    'recent30',
    'recent90',
    'thisYear',
  ]
  return {
    preset: known.includes(preset as BuyerRankingPreset)
      ? (preset as BuyerRankingPreset)
      : 'custom',
    startDate,
    endDate,
    startTimeMs: startOfDayMsShanghai(startDate),
    endTimeMs: endOfDayMsShanghai(endDate),
    isAll: false,
  }
}

export function buyerRankingRangeToAnalysisRange(
  range: BuyerRankingDateRange,
): import('./date-range').DateRangeResolved {
  if (range.isAll) {
    return {
      startDate: '1970-01-01',
      endDate: '2099-12-31',
      startTimeMs: 0,
      endTimeMs: Number.MAX_SAFE_INTEGER,
    }
  }
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    startTimeMs: range.startTimeMs,
    endTimeMs: range.endTimeMs,
  }
}

export const BUYER_VALUE_RANKING_PRESET_ALIASES: Record<string, BuyerRankingPreset> = {
  last30d: 'recent30',
  last90d: 'recent90',
  thisYear: 'thisYear',
  all: 'all',
  custom: 'custom',
  recent30: 'recent30',
  recent90: 'recent90',
}

export function resolveBuyerValueRankingPreset(presetRaw: string): BuyerRankingPreset {
  const key = presetRaw.trim()
  return BUYER_VALUE_RANKING_PRESET_ALIASES[key] ?? (key as BuyerRankingPreset)
}

export const BUYER_RANKING_PRESET_LABELS: Record<BuyerRankingPreset, string> = {
  today: '当日',
  yesterday: '昨日',
  thisWeek: '本周',
  lastWeek: '上周',
  thisMonth: '本月',
  lastMonth: '上月',
  recent7: '最近7天',
  recent15: '最近15天',
  recent30: '最近30天',
  recent90: '最近90天',
  thisYear: '今年',
  all: '全部',
  custom: '自定义',
}
