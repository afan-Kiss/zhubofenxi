export function formatDailyReportMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDailyReportMoneyCompact(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}`
}

export function formatDailyReportHourly(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}/小时`
}

export function formatDailyReportDensity(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '--'
  return `${Math.round(minutes)}分钟/单`
}

export function formatDailyReportPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '--'
  return `${Math.round(ratio)}%`
}

export function formatDailyReportCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return '--'
  return `${Math.round(count)}单`
}

export function formatDailyReportDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '--'
  const m = Math.round(minutes)
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h > 0 && min > 0) return `${h}小时${min}分`
  if (h > 0) return `${h}小时`
  return `${min}分钟`
}
