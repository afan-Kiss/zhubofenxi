/** 买家排行专用日期范围（与看板 preset 独立） */

export type BuyerRankingPreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'thisMonth'
  | 'lastMonth'
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

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function startOfMonth(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex, 1, 0, 0, 0, 0)
}

function endOfMonth(year: number, monthIndex: number): Date {
  return new Date(new Date(year, monthIndex + 1, 1, 0, 0, 0, 0).getTime() - 1)
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  const s = new Date(d)
  s.setDate(s.getDate() - diff)
  return startOfDay(s)
}

export function resolveBuyerRankingDateRange(
  presetRaw: string,
  customStart?: string,
  customEnd?: string,
): BuyerRankingDateRange {
  const preset = presetRaw as BuyerRankingPreset
  const now = new Date()

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

  let start: Date
  let end: Date

  switch (preset) {
    case 'today':
      start = startOfDay(now)
      end = endOfDay(now)
      break
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      start = startOfDay(y)
      end = endOfDay(y)
      break
    }
    case 'thisWeek':
      start = startOfWeekMonday(now)
      end = endOfDay(now)
      break
    case 'thisMonth':
      start = startOfMonth(now.getFullYear(), now.getMonth())
      end = endOfMonth(now.getFullYear(), now.getMonth())
      break
    case 'lastMonth': {
      const m = now.getMonth() - 1
      const y = m < 0 ? now.getFullYear() - 1 : now.getFullYear()
      const monthIndex = m < 0 ? 11 : m
      start = startOfMonth(y, monthIndex)
      end = endOfMonth(y, monthIndex)
      break
    }
    case 'custom':
    default: {
      const sd = customStart?.trim()
      const ed = customEnd?.trim()
      if (!sd || !ed || !DATE_RE.test(sd) || !DATE_RE.test(ed)) {
        throw new Error('自定义日期范围无效，请使用 YYYY-MM-DD 格式')
      }
      start = startOfDay(parseDateKey(sd))
      end = endOfDay(parseDateKey(ed))
      if (start.getTime() > end.getTime()) {
        throw new Error('开始日期不能晚于结束日期')
      }
      break
    }
  }

  const known: BuyerRankingPreset[] = [
    'today',
    'yesterday',
    'thisWeek',
    'thisMonth',
    'lastMonth',
  ]
  return {
    preset: known.includes(preset as BuyerRankingPreset)
      ? (preset as BuyerRankingPreset)
      : 'custom',
    startDate: formatDateKey(start),
    endDate: formatDateKey(end),
    startTimeMs: start.getTime(),
    endTimeMs: end.getTime(),
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

export const BUYER_RANKING_PRESET_LABELS: Record<BuyerRankingPreset, string> = {
  today: '当日',
  yesterday: '昨日',
  thisWeek: '本周',
  thisMonth: '本月',
  lastMonth: '上月',
  all: '全部',
  custom: '自定义',
}
