export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last15'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom'

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: '当天',
  yesterday: '昨天',
  last15: '最近15天',
  thisMonth: '本月',
  lastMonth: '上月',
  custom: '自定义',
}

export interface DateRangePayload {
  preset: string
  startDate?: string
  endDate?: string
}

export function toApiPreset(preset: DateRangePreset): string {
  if (preset === 'last15') return 'last15days'
  return preset
}

export function buildRangeQuery(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
): string {
  const params = new URLSearchParams({ preset: toApiPreset(preset) })
  if (preset === 'custom' && customStart && customEnd) {
    params.set('startDate', customStart)
    params.set('endDate', customEnd)
  }
  return params.toString()
}

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  'today',
  'yesterday',
  'last15',
  'thisMonth',
  'lastMonth',
  'custom',
]

export const RANGE_ACTION_LABELS: Record<DateRangePreset, string> = {
  today: '查看当天数据',
  yesterday: '查看昨天数据',
  last15: '查看最近15天数据',
  thisMonth: '查看本月数据',
  lastMonth: '查看上月数据',
  custom: '查看该范围数据',
}

/** @deprecated 使用 RANGE_ACTION_LABELS */
export const REFRESH_BUTTON_LABELS = RANGE_ACTION_LABELS

export function getRangeActionLabel(preset: DateRangePreset): string {
  return RANGE_ACTION_LABELS[preset]
}

/** @deprecated 使用 getRangeActionLabel */
export function getRefreshButtonLabel(preset: DateRangePreset): string {
  return getRangeActionLabel(preset)
}

export function buildRangePayload(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
): DateRangePayload {
  if (preset === 'custom') {
    return { preset, startDate: customStart, endDate: customEnd }
  }
  return { preset: toApiPreset(preset) }
}
