export interface MoneyParseOk {
  ok: true
  cent: number
}

export interface MoneyParseFail {
  ok: false
  error: string
}

export type MoneyParseResult = MoneyParseOk | MoneyParseFail

const EMPTY_VALUES = new Set(['', '-', '—', '–', 'null', 'undefined', 'N/A', 'n/a'])

export function parseMoneyToCent(value: unknown): MoneyParseResult {
  if (value === null || value === undefined) {
    return { ok: false, error: '金额为空' }
  }

  const raw = String(value).trim()
  if (EMPTY_VALUES.has(raw)) {
    return { ok: false, error: '金额为空' }
  }

  const cleaned = raw.replace(/[¥￥\s]/g, '').replace(/,/g, '')
  if (cleaned === '' || EMPTY_VALUES.has(cleaned)) {
    return { ok: false, error: '金额为空' }
  }

  const match = cleaned.match(/^(-)?(\d+)(?:\.(\d+))?$/)
  if (!match) {
    return { ok: false, error: '金额解析失败' }
  }

  const negative = Boolean(match[1])
  const intPart = Number(match[2])
  const fracStr = (match[3] ?? '').slice(0, 2).padEnd(2, '0')
  const fracPart = fracStr === '' ? 0 : Number(fracStr)

  if (!Number.isFinite(intPart) || !Number.isFinite(fracPart)) {
    return { ok: false, error: '金额解析失败' }
  }

  let cent = intPart * 100 + fracPart
  if (negative) cent = -cent

  return { ok: true, cent }
}

export function formatCent(cent: number): string {
  const negative = cent < 0
  const abs = Math.abs(cent)
  const yuan = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `${yuan.toLocaleString('zh-CN')}.${String(remainder).padStart(2, '0')}`
  return `${negative ? '-' : ''}¥${formatted}`
}

export function sumCent(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0)
}

export function centToYuan(cent: number): number {
  return cent / 100
}

/** 展示用金额：¥10,079.90 */
export function formatYuan(yuan: number): string {
  const n = Number(yuan)
  if (!Number.isFinite(n)) return '¥0.00'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 展示用数量（无万/k 缩写） */
export function formatCount(value: number): string {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('zh-CN')
}

/** 展示用百分比：3.27% */
export function formatRate(rate: number): string {
  const r = Number(rate)
  if (!Number.isFinite(r)) return '0.00%'
  return `${(r * 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}
