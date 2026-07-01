export function formatMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatIntegerMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}`
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '--'
  const m = Math.round(minutes)
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h > 0 && min > 0) return `${h}小时${min}分`
  if (h > 0) return `${h}小时`
  return `${min}分钟`
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '--'
  return `${Math.round(ratio)}%`
}

export function formatDensity(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '--'
  return `${Math.round(minutes)}分钟/单`
}

export function formatHourly(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}/小时`
}

export function formatOrderCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return '--'
  return `${Math.round(count)}单`
}

export function formatPeopleCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return '--'
  return `${Math.round(count).toLocaleString('zh-CN')}人`
}

export function formatRatePercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '--'
  return `${(ratio * 100).toFixed(1)}%`
}

export function formatStayDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--'
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`
  }
  return `${Math.round(seconds)}秒`
}
