import { resolveDateRange, type DateRangePreset } from './date-range'

const ALLOWED_PRESETS = new Set<DateRangePreset>([
  'today',
  'yesterday',
  'last7',
  'last15',
  'thisMonth',
  'lastMonth',
  'custom',
])

export function normalizeSyncPreset(preset: string): DateRangePreset {
  if (preset === 'last7days') return 'last7'
  if (preset === 'last15days') return 'last15'
  return preset as DateRangePreset
}

export function validateSyncRangeInput(input: {
  preset?: unknown
  startDate?: unknown
  endDate?: unknown
}): { preset: DateRangePreset; startDate: string; endDate: string } {
  if (input.preset == null || String(input.preset).trim() === '') {
    throw new Error('缺少日期范围 preset，拒绝同步（不允许默认全量）')
  }

  const preset = normalizeSyncPreset(String(input.preset).trim())
  if (!ALLOWED_PRESETS.has(preset)) {
    throw new Error(`不支持的日期范围 preset: ${String(input.preset)}`)
  }

  const startRaw = input.startDate != null ? String(input.startDate).trim() : ''
  const endRaw = input.endDate != null ? String(input.endDate).trim() : ''

  if (preset === 'custom') {
    if (!startRaw || !endRaw) {
      throw new Error('自定义范围同步必须提供 startDate 与 endDate')
    }
  }

  const range = resolveDateRange(
    preset,
    preset === 'custom' ? startRaw : undefined,
    preset === 'custom' ? endRaw : undefined,
  )

  return {
    preset,
    startDate: range.startDate,
    endDate: range.endDate,
  }
}
