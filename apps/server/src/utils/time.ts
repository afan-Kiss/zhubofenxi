export interface DateParseOk {
  ok: true
  date: Date
}

export interface DateParseFail {
  ok: false
  error: string
}

export type DateParseResult = DateParseOk | DateParseFail

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

function parseChineseDateTime(text: string): Date | null {
  const cn = text.match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  )
  if (cn) {
    const date = new Date(
      Number(cn[1]),
      Number(cn[2]) - 1,
      Number(cn[3]),
      Number(cn[4] ?? 0),
      Number(cn[5] ?? 0),
      Number(cn[6] ?? 0),
    )
    return Number.isNaN(date.getTime()) ? null : date
  }

  const normalized = text.replace(/\//g, '-')
  const std = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  )
  if (std) {
    const date = new Date(
      Number(std[1]),
      Number(std[2]) - 1,
      Number(std[3]),
      Number(std[4] ?? 0),
      Number(std[5] ?? 0),
      Number(std[6] ?? 0),
    )
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function parseExcelSerial(value: number): Date | null {
  if (!Number.isFinite(value)) return null
  const date = new Date(EXCEL_EPOCH_MS + value * 86400000)
  return Number.isNaN(date.getTime()) ? null : date
}

export function parseDateTime(value: unknown): DateParseResult {
  if (value === null || value === undefined) {
    return { ok: false, error: '时间为空' }
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { ok: false, error: '时间解析失败' }
      : { ok: true, date: value }
  }

  if (typeof value === 'number') {
    const date = parseExcelSerial(value)
    return date ? { ok: true, date } : { ok: false, error: '时间解析失败' }
  }

  const text = String(value).trim()
  if (text === '' || text === '-' || text === '—') {
    return { ok: false, error: '时间为空' }
  }

  const asNum = Number(text)
  if (!Number.isNaN(asNum) && /^\d+(\.\d+)?$/.test(text)) {
    const date = parseExcelSerial(asNum)
    if (date) return { ok: true, date }
  }

  const parsed = parseChineseDateTime(text)
  if (parsed) return { ok: true, date: parsed }

  const fallback = new Date(text)
  if (!Number.isNaN(fallback.getTime())) {
    return { ok: true, date: fallback }
  }

  return { ok: false, error: '时间解析失败' }
}

export function getMonthKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function getDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getTimeMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

export function formatDateTime(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}
