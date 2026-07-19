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
  const rounded = Math.round(ratio * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

/** 日报卡片：无真实发货时不展示 0% 占比 */
export function formatShippedSharePercent(
  ratio: number | null | undefined,
  shippedAmountYuan: number | null | undefined,
): string {
  if (shippedAmountYuan == null || shippedAmountYuan <= 0) return '--'
  return formatPercent(ratio)
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

/** 大屏人数指标：缺失时显示「数据缺失」，禁止把 null 显示成 0 人或 -- */
export function formatPeopleCountOrMissing(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return '数据缺失'
  return `${Math.round(count).toLocaleString('zh-CN')}人`
}

export function formatRatePercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '--'
  return `${(ratio * 100).toFixed(1)}%`
}

/** 封面点击率合格线：≥7% */
export const COVER_CLICK_RATE_PASS_THRESHOLD = 0.07

export type CoverClickRateQualityStatus = 'pass' | 'fail' | 'missing'

export function resolveCoverClickRateQuality(
  ratio: number | null | undefined,
): { status: CoverClickRateQualityStatus; pctText: string | null; label: string } {
  if (ratio == null || !Number.isFinite(ratio)) {
    return { status: 'missing', pctText: null, label: '数据缺失' }
  }
  const pctText = `${(ratio * 100).toFixed(1)}%`
  const ok = ratio >= COVER_CLICK_RATE_PASS_THRESHOLD
  return {
    status: ok ? 'pass' : 'fail',
    pctText,
    label: ok ? '合格' : '需提升',
  }
}

/** 纯文本（兼容旧调用）；缺失为「数据缺失」而非「--」 */
export function formatCoverClickRateWithQuality(ratio: number | null | undefined): string {
  const q = resolveCoverClickRateQuality(ratio)
  if (q.status === 'missing') return '数据缺失'
  return `${q.pctText} ${q.label}`
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
