/** 排班时间 HH:mm；结束时间可为 24:00 */
const HM_RE = /^(\d{1,2}):(\d{2})$/

export const SCHEDULE_DAY_MINUTES = 24 * 60
export const SCHEDULE_SNAP_MINUTES = 5
export const SCHEDULE_MIN_DURATION_MINUTES = 5

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

/** HH:mm / 24:00 → 绝对分钟；非法返回 null */
export function scheduleTimeToMinutes(value: string): number | null {
  const parts = parseScheduleTime(value)
  if (!parts) return null
  if (parts.hour === 24) return SCHEDULE_DAY_MINUTES
  return parts.hour * 60 + parts.minute
}

/** 绝对分钟 → HH:mm / 24:00；先钳制到 [0, 1440] */
export function scheduleMinutesToTime(totalMinutes: number): string {
  const m = clampScheduleMinutes(totalMinutes)
  if (m >= SCHEDULE_DAY_MINUTES) return '24:00'
  const hour = Math.floor(m / 60)
  const minute = m % 60
  return formatScheduleTime(hour, minute)
}

export function clampScheduleMinutes(totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes)) return 0
  return Math.min(SCHEDULE_DAY_MINUTES, Math.max(0, Math.round(totalMinutes)))
}

/** 吸附到 step 分钟（默认 5），并钳制到当天 */
export function snapScheduleMinutes(
  totalMinutes: number,
  step: number = SCHEDULE_SNAP_MINUTES,
): number {
  const safeStep = step > 0 ? step : SCHEDULE_SNAP_MINUTES
  const clamped = clampScheduleMinutes(totalMinutes)
  const snapped = Math.round(clamped / safeStep) * safeStep
  return clampScheduleMinutes(snapped)
}

/** 保证 end - start >= minDuration，并落在当天内 */
export function clampScheduleInterval(
  startMin: number,
  endMin: number,
  minDuration: number = SCHEDULE_MIN_DURATION_MINUTES,
): { start: number; end: number } {
  let start = clampScheduleMinutes(startMin)
  let end = clampScheduleMinutes(endMin)
  if (end - start < minDuration) {
    end = Math.min(SCHEDULE_DAY_MINUTES, start + minDuration)
    if (end - start < minDuration) {
      start = Math.max(0, end - minDuration)
    }
  }
  return { start, end }
}

export function formatScheduleDuration(startMin: number, endMin: number): string {
  const mins = Math.max(0, endMin - startMin)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h <= 0) return `${m}分钟`
  if (m === 0) return `${h}小时`
  return `${h}小时${m}分钟`
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
