import { endOfDayMsShanghai } from './business-timezone'
import {
  resolveDateRange,
  type DateRangePreset,
  type DateRangeResolved,
} from './date-range'

export type BusinessRangePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom'

/** 经营看板日期范围唯一键（前后端一致） */
export function buildBusinessRangeKey(
  preset: string,
  startDate: string,
  endDate: string,
): string {
  return `${preset}|${startDate}|${endDate}`
}

/** 经营看板统一日期范围：实时 preset 的 endDate 均为今天（非月底） */
export function resolveBusinessRange(
  preset: BusinessRangePreset,
  customStart?: string,
  customEnd?: string,
): DateRangeResolved {
  return resolveDateRange(preset as DateRangePreset, customStart, customEnd)
}

/** 实时范围的有效覆盖结束时刻（不要求覆盖未来时间） */
export function computeEffectiveCoverageEndMs(params: {
  endDate: string
  now?: Date
  lastSuccessAt?: string | null
  dataMaxTime?: Date | null
}): number {
  const now = params.now ?? new Date()
  const queryEndMs = endOfDayMsShanghai(params.endDate)
  const nowMs = now.getTime()
  const lastSuccessMs = params.lastSuccessAt ? Date.parse(params.lastSuccessAt) : Infinity
  const dataMaxMs = params.dataMaxTime?.getTime() ?? Infinity
  return Math.min(queryEndMs, nowMs, lastSuccessMs, dataMaxMs)
}
