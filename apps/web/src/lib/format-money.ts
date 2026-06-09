/** @deprecated 仅保留类型兼容；展示一律使用完整数字 */
export type AmountDisplayMode = 'full' | 'wan'

/** 金额：¥10,079.90 */
export function formatMoneyDisplay(yuan: number, _mode?: AmountDisplayMode): string {
  const n = Number(yuan)
  if (!Number.isFinite(n)) return '¥0.00'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 数量：9、1,231（无万/k 缩写） */
export function formatCountDisplay(value: number): string {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('zh-CN')
}

/** 比率：3.27%；分母为 0 或缺失时显示 -- */
export function formatRateDisplay(rate: number | null | undefined): string {
  if (rate == null || rate === undefined) return '--'
  const r = Number(rate)
  if (!Number.isFinite(r)) return '--'
  return `${(r * 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

export function formatCentDisplay(cent: number, mode?: AmountDisplayMode): string {
  return formatMoneyDisplay(cent / 100, mode)
}
