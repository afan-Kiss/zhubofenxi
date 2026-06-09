/** 经营统计统一使用中国业务时区 */
export const BUSINESS_TIMEZONE = 'Asia/Shanghai'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export function shanghaiDateParts(date: Date = new Date()): {
  year: number
  month: number
  day: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

export function formatDateKeyShanghai(date: Date = new Date()): string {
  const { year, month, day } = shanghaiDateParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseDateKeyShanghai(dateKey: string): { year: number; month: number; day: number } {
  if (!DATE_KEY_RE.test(dateKey)) {
    throw new Error(`无效日期键: ${dateKey}`)
  }
  const [y, m, d] = dateKey.split('-').map(Number)
  return { year: y!, month: m!, day: d! }
}

/** 某日 00:00:00.000 Asia/Shanghai */
export function startOfDayMsShanghai(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00+08:00`)
}

/** 某日 23:59:59.999 Asia/Shanghai */
export function endOfDayMsShanghai(dateKey: string): number {
  return Date.parse(`${dateKey}T23:59:59.999+08:00`)
}

export function addDaysShanghai(dateKey: string, deltaDays: number): string {
  const ms = startOfDayMsShanghai(dateKey) + deltaDays * 86_400_000
  return formatDateKeyShanghai(new Date(ms))
}

export function startOfMonthKeyShanghai(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function endOfMonthKeyShanghai(year: number, month: number): string {
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const lastDayMs = startOfDayMsShanghai(startOfMonthKeyShanghai(nextMonth.y, nextMonth.m)) - 1
  return formatDateKeyShanghai(new Date(lastDayMs))
}

/** 本周一（Asia/Shanghai） */
export function thisWeekStartKeyShanghai(now: Date = new Date()): string {
  const todayKey = formatDateKeyShanghai(now)
  const day = new Date(startOfDayMsShanghai(todayKey)).getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  return addDaysShanghai(todayKey, -diff)
}
