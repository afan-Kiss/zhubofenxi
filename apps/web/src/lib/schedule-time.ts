/** 排班时间 HH:mm；结束时间可为 24:00 */
const HM_RE = /^(\d{1,2}):(\d{2})$/

export interface ScheduleTimeParts {
  hour: number
  minute: number
}

export function parseScheduleTime(value: string): ScheduleTimeParts | null {
  const raw = value.trim()
  if (raw === '24:00') return { hour: 24, minute: 0 }
  const m = HM_RE.exec(raw)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

export function formatScheduleTime(hour: number, minute: number): string {
  if (hour === 24 && minute === 0) return '24:00'
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function normalizeScheduleTimeInput(value: string, allowMidnight = false): string {
  const parts = parseScheduleTime(value)
  if (!parts) return allowMidnight ? '18:00' : '09:00'
  if (parts.hour === 24) return allowMidnight ? '24:00' : '23:59'
  return formatScheduleTime(parts.hour, parts.minute)
}

export const SCHEDULE_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour)

export const SCHEDULE_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5)

export const SCHEDULE_START_PRESETS = [
  '09:00',
  '09:30',
  '14:00',
  '14:15',
  '14:30',
  '18:00',
  '18:30',
] as const

export const SCHEDULE_END_PRESETS = ['18:00', '21:00', '24:00'] as const
