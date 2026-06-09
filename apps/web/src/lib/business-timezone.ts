/** 与后端 date-range 一致：经营日期按 Asia/Shanghai */
export const BUSINESS_TIMEZONE = 'Asia/Shanghai'

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

export function addDaysShanghai(dateKey: string, deltaDays: number): string {
  const ms = Date.parse(`${dateKey}T00:00:00+08:00`) + deltaDays * 86_400_000
  return formatDateKeyShanghai(new Date(ms))
}

export function startOfMonthKeyShanghai(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function endOfMonthKeyShanghai(year: number, month: number): string {
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const lastDayMs =
    Date.parse(`${startOfMonthKeyShanghai(nextMonth.y, nextMonth.m)}T00:00:00+08:00`) - 1
  return formatDateKeyShanghai(new Date(lastDayMs))
}

export function thisWeekStartKeyShanghai(now: Date = new Date()): string {
  const todayKey = formatDateKeyShanghai(now)
  const day = new Date(Date.parse(`${todayKey}T00:00:00+08:00`)).getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  return addDaysShanghai(todayKey, -diff)
}
