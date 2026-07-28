/** 线下录入成交时间：跟页面单日对齐，并按上海墙钟提交 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 上海时区当前 HH:mm */
export function shanghaiNowHm(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}

/** 上海时区今日 YYYY-MM-DD */
export function shanghaiTodayDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * datetime-local 默认值：优先用页面选中的单日（今日/昨日），
 * 时刻取上海当前时分，避免选昨日却默认写到今日。
 */
export function defaultOfflineDealAtInput(
  preferredDateKey?: string | null,
  now: Date = new Date(),
): string {
  const day =
    preferredDateKey && DATE_KEY_RE.test(preferredDateKey.trim())
      ? preferredDateKey.trim()
      : shanghaiTodayDateKey(now)
  return `${day}T${shanghaiNowHm(now)}`
}

/** 将 datetime-local（按上海墙钟）转为 ISO，避免浏览器本地时区偏移 */
export function offlineDealAtToIso(dealAtLocal: string): string {
  const raw = dealAtLocal.trim()
  if (!raw) throw new Error('成交时间无效')
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00` : raw
  const ms = Date.parse(`${withSeconds}+08:00`)
  if (!Number.isFinite(ms)) throw new Error('成交时间无效')
  return new Date(ms).toISOString()
}
