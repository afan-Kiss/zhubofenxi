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

/** 上海日历日星期几：1=周一 … 7=周日（ISO） */
export function weekdayIsoShanghai(dateKey: string): number {
  const ms = Date.parse(`${dateKey}T12:00:00+08:00`)
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'long',
  }).format(new Date(ms))
  const map: Record<string, number> = {
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
    Sunday: 7,
  }
  return map[dayName] ?? 1
}

/** 本周一（Asia/Shanghai）00:00 起，至 todayKey 止 */
export function thisWeekStartKeyShanghai(now: Date = new Date()): string {
  const todayKey = formatDateKeyShanghai(now)
  const daysSinceMonday = weekdayIsoShanghai(todayKey) - 1
  return addDaysShanghai(todayKey, -daysSinceMonday)
}

function shanghaiTimeParts(date: Date): {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  second: string
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  }
}

/** 格式化为 Asia/Shanghai 本地时间文本（与主播时间段配置一致） */
export function formatDateTimeShanghai(date: Date): string {
  const p = shanghaiTimeParts(date)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

/** 格式化为 HH:mm（Asia/Shanghai） */
export function formatClockShanghai(date: Date): string {
  const p = shanghaiTimeParts(date)
  return `${p.hour}:${p.minute}`
}

const LIVE_SESSION_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/

/** 解析直播场次时间文本为毫秒（统一按 Asia/Shanghai） */
export function parseLiveSessionTimeMs(text: string | null | undefined): number | null {
  const raw = text?.trim()
  if (!raw || raw === '—') return null
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : null
  }
  const m = LIVE_SESSION_TIME_RE.exec(raw)
  if (!m) {
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(
    `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`,
  )
  return Number.isFinite(ms) ? ms : null
}
