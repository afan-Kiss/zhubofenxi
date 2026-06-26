import { formatIntegerMoney, formatOrderCount } from '../operationsReportFormatters'

export const CHART_COLORS = [
  '#e11d48',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#0ea5e9',
  '#6366f1',
  '#a855f7',
  '#64748b',
]

export function truncateChartLabel(label: string, max = 14): string {
  const t = label.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function formatChartMoney(yuan: number): string {
  return formatIntegerMoney(yuan)
}

export function formatChartCount(count: number): string {
  return formatOrderCount(count)
}

export function formatMobileDate(dateKey: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateKey)
  if (!m) return dateKey
  return `${Number(m[2])}/${Number(m[3])}`
}

export function takeTopWithOther<T extends { label: string; value: number }>(
  items: T[],
  topN: number,
): Array<T & { isOther?: boolean }> {
  const sorted = [...items].sort((a, b) => b.value - a.value)
  if (sorted.length <= topN) return sorted
  const head = sorted.slice(0, topN)
  const rest = sorted.slice(topN)
  const otherValue = rest.reduce((s, r) => s + r.value, 0)
  if (otherValue <= 0) return head
  return [...head, { label: '其他', value: otherValue, isOther: true } as T & { isOther?: boolean }]
}
